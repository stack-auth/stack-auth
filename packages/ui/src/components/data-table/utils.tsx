export function standardFilterFn (row: any, id: string, value: any) {
  return value.includes(row.getValue(id));
}

export function arrayFilterFn (row: any, id: string, value: any) {
  return value.some((v: any) => row.getValue(id).includes(v));
}
