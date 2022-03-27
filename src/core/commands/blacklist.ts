import { Command, createEmbed, createEmbedMessage, reply } from '../../helpers/discord'
import { oneLine } from 'common-tags'
import { getFlatGuildRelayHistory, addBlacklisted, getSettings } from '../db/functions'
import { CommandInteraction, ContextMenuInteraction } from 'discord.js'
import { isBlacklisted } from '../../modules/livechat/commentBooleans'
import { RelayedComment } from '../db/models/RelayedComment'
import { ContextMenuCommandBuilder } from '@discordjs/builders'
import { warn } from '../../helpers'

export const blacklist: Command = {
  config: {
    permLevel: 1,
  },
  help: {
    category: 'Relay',
    description: oneLine`Blacklists author`,
  },
  slash: new ContextMenuCommandBuilder().setName('blacklist').setType(3), // message
  callback: async (intr: CommandInteraction): Promise<void> => {
    if (!intr.isMessageContextMenu()) {
      warn('Something very weird happened.')
      return
    }
    const reason = 'Requested by context menu interaction'
    blacklistTl(intr, reason)
  },
}

//////////////////////////////////////////////////////////////////////////////

function blacklistTl(intr: ContextMenuInteraction, reason: string): void {
  const settings = getSettings(intr.guild!)
  const refId = intr.targetId
  const history = getFlatGuildRelayHistory(intr.guild!)
  const culprit = history.find((cmt) => cmt.msgId === refId)
  const duplicate = culprit && isBlacklisted(culprit.ytId, settings)
  const callback = duplicate
    ? notifyDuplicate
    : culprit
    ? addBlacklistedAndConfirm
    : notifyTranslatorNotFound

  callback(intr, culprit!, reason)
}

function notifyDuplicate(intr: ContextMenuInteraction): void {
  reply(intr, createEmbedMessage(':warning: Already blacklisted'))
}

function addBlacklistedAndConfirm(
  intr: ContextMenuInteraction,
  { ytId, author }: RelayedComment,
  reason: string,
): void {
  addBlacklisted(intr.guild!, { ytId: ytId, name: author, reason })
  reply(
    intr,
    createEmbed({
      fields: [
        {
          name: ':no_entry: Blacklister',
          value: intr.user.toString(),
          inline: true,
        },
        {
          name: ':clown: Blacklisted channel',
          value: author,
          inline: true,
        },
        {
          name: ':bookmark_tabs: Reason',
          value: reason,
          inline: true,
        },
      ],
    }),
  )
}

function notifyTranslatorNotFound(intr: ContextMenuInteraction): void {
  reply(intr, createEmbedMessage(':warning: Translator data not found.'))
}
