/**
 * Worker Pool
 * 
 * Pool de workers genérico para processamento paralelo de tarefas CPU-bound.
 * Implementa distribuição de trabalho, gerenciamento de ciclo de vida e
 * recuperação de erros.
 * 
 * @module WorkerPool
 */

import { Worker } from 'worker_threads';
import { cpus } from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import {
    WorkerPoolOptions,
    WorkerTask,
    WorkerMessage,
    WorkerStats
} from './types';

const LOG_PREFIX = '[WorkerPool]';

interface WorkerState {
    worker: Worker;
    busy: boolean;
    currentTask: WorkerTask | null;
    completedTasks: number;
    failedTasks: number;
    totalProcessingTime: number;
}

export class WorkerPool extends EventEmitter {
    private readonly poolSize: number;
    private readonly taskTimeout: number;
    private readonly name: string;
    private readonly workerPath: string;
    private workers: WorkerState[] = [];
    private taskQueue: WorkerTask[] = [];
    private isShuttingDown = false;
    private taskIdCounter = 0;

    // Stats
    private totalTasks = 0;
    private completedTasks = 0;
    private failedTasks = 0;
    private totalProcessingTime = 0;

    constructor(workerPath: string, options: WorkerPoolOptions = {}) {
        super();
        const numCpus = cpus().length;
        this.poolSize = options.poolSize ?? Math.max(1, numCpus - 1);
        this.taskTimeout = options.taskTimeout ?? 300000; // 5 minutes default
        this.name = options.name ?? 'WorkerPool';
        this.workerPath = workerPath;

        console.log(`${LOG_PREFIX} [${this.name}] Initializing with ${this.poolSize} workers`);
    }

    /**
     * Inicializa o pool de workers
     */
    async initialize(): Promise<void> {
        if (this.workers.length > 0) {
            console.warn(`${LOG_PREFIX} [${this.name}] Already initialized`);
            return;
        }

        const initPromises: Promise<void>[] = [];

        for (let i = 0; i < this.poolSize; i++) {
            initPromises.push(this.createWorker(i));
        }

        await Promise.all(initPromises);
        console.log(`${LOG_PREFIX} [${this.name}] All ${this.poolSize} workers ready`);
    }

    private async createWorker(index: number): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const worker = new Worker(this.workerPath, {
                    workerData: { workerId: index, poolName: this.name }
                });

                const state: WorkerState = {
                    worker,
                    busy: false,
                    currentTask: null,
                    completedTasks: 0,
                    failedTasks: 0,
                    totalProcessingTime: 0
                };

                worker.on('message', (message: WorkerMessage) => {
                    this.handleWorkerMessage(state, message);
                });

                worker.on('error', (error) => {
                    console.error(`${LOG_PREFIX} [${this.name}] Worker ${index} error:`, error);
                    this.handleWorkerError(state, error);
                });

                worker.on('exit', (code) => {
                    if (code !== 0 && !this.isShuttingDown) {
                        console.error(`${LOG_PREFIX} [${this.name}] Worker ${index} exited with code ${code}, restarting...`);
                        this.restartWorker(index);
                    }
                });

                // Wait for ready message
                const readyHandler = (message: WorkerMessage) => {
                    if (message.type === 'ready') {
                        worker.off('message', readyHandler);
                        this.workers[index] = state;
                        resolve();
                    }
                };

                worker.on('message', readyHandler);

                // Timeout for initialization
                setTimeout(() => {
                    if (!this.workers[index]) {
                        worker.off('message', readyHandler);
                        reject(new Error(`Worker ${index} failed to initialize within timeout`));
                    }
                }, 10000);

            } catch (error) {
                reject(error);
            }
        });
    }

    private handleWorkerMessage(state: WorkerState, message: WorkerMessage): void {
        if (message.type === 'result' || message.type === 'error') {
            const task = state.currentTask;
            if (!task) {
                console.warn(`${LOG_PREFIX} [${this.name}] Received result but no task in progress`);
                return;
            }

            const processingTime = Date.now() - task.startTime;
            state.totalProcessingTime += processingTime;
            this.totalProcessingTime += processingTime;

            if (message.type === 'result') {
                state.completedTasks++;
                this.completedTasks++;
                task.resolve(message.data);
            } else {
                state.failedTasks++;
                this.failedTasks++;
                task.reject(new Error(message.error ?? 'Unknown worker error'));
            }

            state.busy = false;
            state.currentTask = null;
            this.processNextTask();
        }
    }

    private handleWorkerError(state: WorkerState, error: Error): void {
        if (state.currentTask) {
            state.failedTasks++;
            this.failedTasks++;
            state.currentTask.reject(error);
            state.currentTask = null;
        }
        state.busy = false;
    }

    private async restartWorker(index: number): Promise<void> {
        if (this.isShuttingDown) return;

        try {
            // Terminate existing worker if still alive
            const existing = this.workers[index];
            if (existing?.worker) {
                try {
                    await existing.worker.terminate();
                } catch {
                    // Ignore termination errors
                }
            }

            await this.createWorker(index);
            console.log(`${LOG_PREFIX} [${this.name}] Worker ${index} restarted successfully`);
            this.processNextTask();
        } catch (error) {
            console.error(`${LOG_PREFIX} [${this.name}] Failed to restart worker ${index}:`, error);
        }
    }

    private getAvailableWorker(): WorkerState | null {
        for (const state of this.workers) {
            if (state && !state.busy) {
                return state;
            }
        }
        return null;
    }

    private processNextTask(): void {
        if (this.isShuttingDown || this.taskQueue.length === 0) return;

        const worker = this.getAvailableWorker();
        if (!worker) return;

        const task = this.taskQueue.shift();
        if (!task) return;

        worker.busy = true;
        worker.currentTask = task;

        const message: WorkerMessage = {
            type: 'task',
            taskId: task.id,
            data: { type: task.type, data: task.data }
        };

        worker.worker.postMessage(message);

        // Set timeout for task
        setTimeout(() => {
            if (worker.currentTask?.id === task.id) {
                console.error(`${LOG_PREFIX} [${this.name}] Task ${task.id} timed out`);
                this.handleWorkerError(worker, new Error('Task timeout'));
            }
        }, this.taskTimeout);
    }

    /**
     * Executa uma tarefa no pool de workers
     * @param type Tipo da tarefa (usado pelo worker para rotear)
     * @param data Dados da tarefa
     * @returns Promise com o resultado
     */
    exec<TInput, TOutput>(type: string, data: TInput): Promise<TOutput> {
        return new Promise((resolve, reject) => {
            if (this.isShuttingDown) {
                reject(new Error('WorkerPool is shutting down'));
                return;
            }

            if (this.workers.length === 0) {
                reject(new Error('WorkerPool not initialized. Call initialize() first.'));
                return;
            }

            const task: WorkerTask<TInput, TOutput> = {
                id: `${this.name}-${++this.taskIdCounter}`,
                type,
                data,
                resolve,
                reject,
                startTime: Date.now()
            };

            this.totalTasks++;
            this.taskQueue.push(task as WorkerTask);
            this.processNextTask();
        });
    }

    /**
     * Executa múltiplas tarefas em paralelo
     * @param tasks Array de tarefas {type, data}
     * @returns Promise com array de resultados
     */
    async execBatch<TInput, TOutput>(tasks: Array<{ type: string; data: TInput }>): Promise<TOutput[]> {
        return Promise.all(tasks.map(t => this.exec<TInput, TOutput>(t.type, t.data)));
    }

    /**
     * Obtém estatísticas do pool
     */
    getStats(): WorkerStats {
        const activeWorkers = this.workers.filter(w => w?.busy).length;
        const avgProcessingTime = this.completedTasks > 0
            ? this.totalProcessingTime / this.completedTasks
            : 0;

        return {
            totalTasks: this.totalTasks,
            completedTasks: this.completedTasks,
            failedTasks: this.failedTasks,
            avgProcessingTime,
            activeWorkers,
            queuedTasks: this.taskQueue.length
        };
    }

    /**
     * Retorna o tamanho do pool
     */
    get size(): number {
        return this.poolSize;
    }

    /**
     * Verifica se o pool está ocioso
     */
    isIdle(): boolean {
        return this.taskQueue.length === 0 && this.workers.every(w => !w?.busy);
    }

    /**
     * Aguarda até que o pool esteja ocioso
     */
    async waitForIdle(timeoutMs = 60000): Promise<void> {
        const startTime = Date.now();
        while (!this.isIdle()) {
            if (Date.now() - startTime > timeoutMs) {
                throw new Error('Timeout waiting for WorkerPool to become idle');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * Encerra o pool de workers graciosamente
     */
    async shutdown(): Promise<void> {
        if (this.isShuttingDown) return;

        this.isShuttingDown = true;
        console.log(`${LOG_PREFIX} [${this.name}] Shutting down...`);

        // Reject all queued tasks
        for (const task of this.taskQueue) {
            task.reject(new Error('WorkerPool shutting down'));
        }
        this.taskQueue = [];

        // Terminate all workers
        const terminatePromises = this.workers.map(async (state, index) => {
            if (!state?.worker) return;

            try {
                // Send shutdown message
                const shutdownMessage: WorkerMessage = { type: 'shutdown' };
                state.worker.postMessage(shutdownMessage);

                // Wait a bit for graceful shutdown
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Force terminate if still running
                await state.worker.terminate();
                console.log(`${LOG_PREFIX} [${this.name}] Worker ${index} terminated`);
            } catch (error) {
                console.error(`${LOG_PREFIX} [${this.name}] Error terminating worker ${index}:`, error);
            }
        });

        await Promise.all(terminatePromises);
        this.workers = [];

        const stats = this.getStats();
        console.log(`${LOG_PREFIX} [${this.name}] Shutdown complete. Stats:`, stats);
    }
}

export default WorkerPool;
