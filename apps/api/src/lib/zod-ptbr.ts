import { z } from 'zod';

// Portuguese (pt-BR) error map for Zod (server side)
z.setErrorMap((issue, ctx) => {
    const defaultMsg = 'Valor inválido';

    switch (issue.code) {
        case z.ZodIssueCode.invalid_type:
            if (issue.expected === 'string') return { message: 'Deve ser texto' };
            if (issue.expected === 'number') return { message: 'Deve ser um número' };
            if (issue.expected === 'boolean') return { message: 'Deve ser verdadeiro/falso' };
            return { message: `Tipo inválido (esperado: ${issue.expected})` };

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

        case z.ZodIssueCode.invalid_string: {
            const v = (issue as any).validation;
            if (v === 'email') return { message: 'Email inválido' };
            if (v === 'regex') return { message: 'Formato inválido' };
            return { message: 'Texto inválido' };
        }

        case z.ZodIssueCode.too_small:
            if (issue.type === 'string') return { message: `Deve ter no mínimo ${issue.minimum} caracteres` };
            if (issue.type === 'number') return { message: `Deve ser no mínimo ${issue.minimum}` };
            if (issue.type === 'array') return { message: `Deve ter pelo menos ${issue.minimum} itens` };
            return { message: defaultMsg };

        case z.ZodIssueCode.too_big:
            if (issue.type === 'string') return { message: `Deve ter no máximo ${issue.maximum} caracteres` };
            if (issue.type === 'number') return { message: `Deve ser no máximo ${issue.maximum}` };
            if (issue.type === 'array') return { message: `Deve ter no máximo ${issue.maximum} itens` };
            return { message: defaultMsg };

        case z.ZodIssueCode.custom:
            return { message: issue.message ?? 'Valor inválido' };

        default:
            return { message: issue.message ?? defaultMsg };
    }
});

export default z;
