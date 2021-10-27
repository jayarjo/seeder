export type TableName = string;

/**
 * Set of preferred values to use for the columns with same name
 */
export type RowFactory = Record<string, any>;
/**
 * Function that receives index of the row to be seeded and should return {@link RowFactory}
 */
export type RowFactoryGenerator = (idx: number) => RowFactory;
export type TableRow = Record<string, any>;
export type SeedRegistry = Record<TableName, TableRow[]>;

export type ColumnCase = 'snakeCase' | 'camelCase' | null | Function;

export type ForeignRef = {
  tableName: string;
  columnName: string;
};

export type Meta = {
  dependencies?: DependencyMesh;
  dependents?: DependencyMesh;
  wasSeeded?: boolean;
  primaryKey?: string;
  foreignRefs?: Record<string, ForeignRef>;
  valueMaps?: Record<string, Record<any, any>>;
};

export type DependencyMesh = Record<TableName, Meta>;

export enum GeometryType {
  LineString = 'LINESTRING',
  Polygon = 'POLYGON',
  MultiPolygon = 'MULTIPOLYGON',
  Geometry = 'GEOMETRY',
  Point = 'POINT',
}

export enum GeometryFormat {
  WKT = 'WKT',
  HEXEWKB = 'HEXEWKB',
  GeoJSON = 'GeoJSON',
}

export type GeometryColumnType = { type: string; is3D: boolean; srid: number };
