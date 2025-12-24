export type Base = {
  id: number;
  nome: string;
  tipo: string;
  subtype?: string | null;
};

export type Column = {
  excel?: string | null;
  sqlite: string;
  index?: string;
};

export type KeyDefinition = {
  id: number;
  nome?: string;
  key_identifier?: string;
  base_tipo?: string | null;
  base_subtipo?: string | null;
  columns?: string[] | string | null;
};

export type KeyPair = {
  id?: number;
  nome?: string;
  descricao?: string | null;
  contabil_key_id?: number | null;
  fiscal_key_id?: number | null;
};

export type KeyRow = {
  id: string;
  key_identifier: string;
  mode: 'pair' | 'separate';
  keys_pair_id: number | null;
  contabil_key_id: number | null;
  fiscal_key_id: number | null;
  ordem?: number;
};
