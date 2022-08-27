export const emoji: Record<Name, EmojiCode> = {
  respond: '<:mikocool:1012509890574549123>',
  deepl: '<:deepl:1012510029888376852>',
  nbsp: '<:nbsp:1012510028390994060>',
  discord: '<:discord:1012510026780389387>',
  holo: '<:Hololive:663796277137506333>',
  ping: '<:mikoping:1012510024419000500>',
  tc: '<:twitcasting:1012510025601777685>',
  yt: '<:youtube:1012509333252210768>',
  peek: '<:mikopeek:1012510032476246156>',
  niji: '<:nijisanji:1012510032476246156>',
} as const

///////////////////////////////////////////////////////////////////////////////

type Name = string
type EmojiCode = string
