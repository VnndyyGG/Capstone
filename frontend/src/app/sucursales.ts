/** Sucursales de Easy Office donde se presta el servicio. Para agregar una, se suma un objeto a la lista. */
export interface Sucursal { sigla: string; nombre: string; valores: Record<string, string>; }

export const SUCURSALES: Sucursal[] = [
  {
    sigla: 'LF',
    nombre: 'La Florida',
    valores: {
      sucursal_direccion: 'VICUÑA MACKENNA PONIENTE #7255 OFICINA 707',
      sucursal_comuna: 'LA FLORIDA',
      sucursal_region: 'METROPOLITANA',
      sii_unidad: 'SAN ANTONIO LA FLORIDA',
      sucursal_rol: '271-147',
    },
  },
];

/** Campos del contrato que salen de la sucursal elegida: el cliente no los escribe. */
export const CAMPOS_SUCURSAL = Object.keys(SUCURSALES[0].valores);
