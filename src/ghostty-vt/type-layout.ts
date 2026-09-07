export type TypeField = {
  offset: number
  size: number
  type: string
}

export type TypeLayout = {
  abi: { pointer_size: number; usize_size: number; endian: string }
  types: Record<
    string,
    {
      kind: string
      size: number
      fields?: Record<string, TypeField>
      values?: Record<string, number>
      underlying?: string
    }
  >
}

export function parseTypeLayout(json: string): TypeLayout {
  return JSON.parse(json) as TypeLayout
}

export function enumValue(layout: TypeLayout, typeName: string, name: string): number {
  const value = layout.types[typeName]?.values?.[name]
  if (value === undefined) {
    throw new Error(`missing ${typeName}.${name}`)
  }
  return value
}

export function structSize(layout: TypeLayout, typeName: string): number {
  const size = layout.types[typeName]?.size
  if (typeof size !== 'number') {
    throw new Error(`missing size for ${typeName}`)
  }
  return size
}

export function field(layout: TypeLayout, typeName: string, fieldName: string): TypeField {
  const found = layout.types[typeName]?.fields?.[fieldName]
  if (!found) {
    throw new Error(`missing ${typeName}.${fieldName}`)
  }
  return found
}
