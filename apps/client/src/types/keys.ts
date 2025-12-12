export type BaseColumn = {
  sqlite_name: string;
  excel_name?: string | null;
};

export type Base = {
  id: number;
  nome: string;
  tipo: string;
  subtype?: string | null;
};

export type KeyItem = {
  id?: number;
  nome: string;
  descricao?: string | null;
  base_tipo?: string | null;
  base_subtipo?: string | null;
  base_id?: number | null;
  columns?: string[];
};
