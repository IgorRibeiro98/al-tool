import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        root: '.',
        include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'test/**/*.test.ts', 'test/**/*.spec.ts'],
        exclude: ['node_modules', 'dist'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'node_modules', 'dist'],
        },
        testTimeout: 30000,
        hookTimeout: 30000,
        setupFiles: ['./test/setup.ts'],
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
