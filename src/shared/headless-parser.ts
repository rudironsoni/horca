export type HeadlessParser = {
  registerOscHandler: (
    ident: number,
    handler: (data: string) => boolean
  ) => { dispose: () => void }
  registerCsiHandler: (
    id: { prefix?: string; final: string },
    handler: (params: (number | number[])[]) => boolean
  ) => { dispose: () => void }
}
