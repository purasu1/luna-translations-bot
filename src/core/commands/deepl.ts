import { toggleSetting } from '../db/functions'
import { Message } from 'discord.js'
import { Command, emoji } from '../../helpers/discord'
import { oneLine } from 'common-tags'

export const deepl: Command = {
  config: {
    aliases:   [],
    permLevel: 2
  },
  help: {
    category: 'Relay',
    usage:    'deepl',
    description: oneLine`
      Toggles automatic DeepL translation for Hololive members' chat messages.
      (Also affects tl.holochats)
    `,
  },
  callback: (msg: Message): void => {
    toggleSetting ({
      msg, setting: 'deepl',
      enable: `
        ${emoji.deepl} I will now translate Vtubers' messages with DeepL.
      `,
      disable: oneLine`
        ${emoji.deepl} I will no longer translate Vtubers' messages
        with DeepL.
      `
    })
  }
}
