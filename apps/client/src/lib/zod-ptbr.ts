import { z } from 'zod';

const DEFAULT_MESSAGE = 'Valor inválido';

function invalidTypeMessage(issue: any): { message: string } {
    const expected = issue?.expected;
    switch (expected) {
        case 'string':
            return { message: 'Deve ser texto' };
        case 'number':
            return { message: 'Deve ser um número' };
        case 'boolean':
            return { message: 'Deve ser verdadeiro/falso' };
        default:
            return { message: `Tipo inválido (esperado: ${expected})` };
    }
}

function invalidStringMessage(issue: any): { message: string } {
    const validation = issue?.validation as string | undefined;
    if (validation === 'email') return { message: 'Email inválido' };
    if (validation === 'regex') return { message: 'Formato inválido' };
    return { message: 'Texto inválido' };
}

function sizeConstraintMessage(issue: any): { message: string } {
    const type = issue?.type as string | undefined;
    const minimum = issue?.minimum;
    const maximum = issue?.maximum;

    if (issue?.code === z.ZodIssueCode.too_small) {
        if (type === 'string') return { message: `Deve ter no mínimo ${minimum} caracteres` };
        if (type === 'number') return { message: `Deve ser no mínimo ${minimum}` };
        if (type === 'array') return { message: `Deve ter pelo menos ${minimum} itens` };
    }

    if (issue?.code === z.ZodIssueCode.too_big) {
        if (type === 'string') return { message: `Deve ter no máximo ${maximum} caracteres` };
        if (type === 'number') return { message: `Deve ser no máximo ${maximum}` };
        if (type === 'array') return { message: `Deve ter no máximo ${maximum} itens` };
    }

    return { message: DEFAULT_MESSAGE };
}

// Centralized mapping for Zod issues to pt-BR messages
z.setErrorMap((issue) => {
    switch (issue.code) {
        case z.ZodIssueCode.invalid_type:
            return invalidTypeMessage(issue);

        case z.ZodIssueCode.invalid_literal:
            return { message: 'Valor literal inválido' };

        case z.ZodIssueCode.unrecognized_keys:
            return { message: 'Chaves não reconhecidas no objeto' };

        case z.ZodIssueCode.invalid_union:
            return { message: 'Valor não corresponde a nenhum dos tipos permitidos' };

        case z.ZodIssueCode.invalid_enum_value:
            return { message: 'Valor não é uma opção válida' };

        case z.ZodIssueCode.invalid_date:
            return { message: 'Data inválida' };

        case z.ZodIssueCode.invalid_string:
            return invalidStringMessage(issue);

        case z.ZodIssueCode.too_small:
        case z.ZodIssueCode.too_big:
            return sizeConstraintMessage(issue);

        case z.ZodIssueCode.custom:
            return { message: issue.message ?? DEFAULT_MESSAGE };

        default:
            return { message: issue.message ?? DEFAULT_MESSAGE };
    }
});

export default z;
