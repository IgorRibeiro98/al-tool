# Lista de arquivos em `apps/desktop` e propósito

Resumo dos arquivos presentes em `apps/desktop` (recursivamente) com uma breve descrição do que cada um faz.

- `apps/desktop/package.json`: Manifesto npm do app desktop (scripts para build/electron, dependências específicas para runtime desktop).
- `apps/desktop/tsconfig.json`: Configuração TypeScript para o projeto desktop.
- `apps/desktop/.env.example`: Variáveis de ambiente de exemplo usadas pelo processo Electron/main (ex.: DATA_DIR overrides, porta do backend integrado, etc.).
- `apps/desktop/readme.md`: Notas específicas do app desktop (empacotamento, execução integrada com `apps/api`, como configurar o runtime Python se aplicável).

Src (main process):
- `apps/desktop/src/main.ts`: Entry point do processo principal do Electron. Provavelmente cria a janela, configura IPC e inicia o backend local (ou conecta ao `apps/api`).

Types / declarações:
- `apps/desktop/src/electron.d.ts`: Declarações TypeScript para integração com APIs Electron personalizadas (tipos IPC, extensões globais usadas no app).

Serviços/Utilitários (main process):
- `apps/desktop/src/main/services/licensingService.ts`: Serviço que lida com ativação/verificação de licença no contexto do Electron (chaves, validações, persistência local).
- `apps/desktop/src/main/machineFingerprint.ts`: Utilitário para gerar/obter fingerprint da máquina (usado pelo licensingService para amarrar licença ao dispositivo).

Observações finais:
- O app desktop parece ser a camada Electron que orquestra a UI (client) e o backend local (`apps/api`), integra licença e geração de fingerprint, e provê env vars específicas para execução integrada.
- Se desejar, posso:
  - gerar `apps/desktop/FILES_SUMMARY.json` com metadados;
  - abrir `src/main.ts` e extrair os canais IPC usados (para documentar mensagens entre renderer e main);
  - ou validar os scripts em `package.json` e sugerir comandos para empacotar/rodar localmente.

Fim.
