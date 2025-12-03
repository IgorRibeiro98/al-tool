import 'node';

declare global {
    namespace NodeJS {
        interface Process {
            readonly resourcesPath: string;
        }
    }
}

export { };
