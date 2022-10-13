import merge from 'ts-deepmerge'
import { client } from '../../core/'
import {
  Message,
  MessageAttachment,
  MessageEmbed,
  MessageEmbedAuthor,
  MessageEmbedOptions,
  MessageEmbedThumbnail,
  MessageOptions,
  MessagePayload,
  TextBasedChannel,
  EmojiIdentifierResolvable,
  MessageReaction,
  MessageButtonOptions,
  MessageButton,
  MessageActionRow,
  CommandInteraction,
  ContextMenuInteraction,
} from 'discord.js'
import { warn } from '../logging'
import { canBot } from './general'
const { isArray } = Array

export async function reply(
  msg: Message | CommandInteraction | ContextMenuInteraction,
  embed?: MessageEmbed | MessageEmbed[],
  text?: string,
  file?: MessageAttachment,
): Promise<Message | Message[] | undefined | void> {
  if (!canBot('SEND_MESSAGES', msg.channel)) return
  const replyFn = msg instanceof Message ? msg.reply.bind(msg) : msg.editReply.bind(msg)
  const contextMenuIntrPayload = {
    ...(embed ? { embeds: isArray(embed) ? embed : [embed] } : {}),
    ...(text ? { content: text } : {}),
    ...(file ? { files: [file] } : {}),
  }
  const payload = { ...contextMenuIntrPayload, failIfNotExists: false }

  if (msg instanceof ContextMenuInteraction) {
    return replyFn(contextMenuIntrPayload).catch((err: any) => {
      warn(err)
      warn('trying to reply normally')
      msg.reply(contextMenuIntrPayload).catch(warn)
    })
  } else {
    return replyFn(payload).catch((err: any) => {
      warn(err)
      warn('trying to reply normally')
      msg.reply(contextMenuIntrPayload).catch(warn)
    })
  }
}

export async function send(
  channel: TextBasedChannel | undefined,
  content: string | MessageOptions | MessagePayload,
): Promise<Message | undefined> {
  console.log('checking perms..')
  if (canBot('SEND_MESSAGES', channel)) {
    console.log('done checking perms, now sending...')
    return channel!.send(content)
      .then((msg) => {
        console.log('finished sending.')
        return msg
      })
      .catch((e) => warn(`${channel!.id} ${e}`))
  }
}

export function createEmbedMessage(body: string, fancy: boolean = false): MessageEmbed {
  return createEmbed({
    author: fancy ? getEmbedSelfAuthor() : undefined,
    thumbnail: fancy ? getEmbedSelfThumbnail() : undefined,
    description: body,
  })
}

export function createEmbed(
  options: Partial<MessageEmbedOptions>,
  fancy: boolean = false,
): MessageEmbed {
  const base: Partial<MessageEmbedOptions> = {
    author: fancy ? getEmbedSelfAuthor() : undefined,
    color: '#8e4497',
    thumbnail: fancy ? getEmbedSelfThumbnail() : undefined,
  }
  return new MessageEmbed(merge(base, options))
}

export function createTxtEmbed(title: string, content: string): MessageAttachment {
  return new MessageAttachment(Buffer.from(content, 'utf-8'), title)
}

export async function react(
  msg: Message | undefined,
  emj: EmojiIdentifierResolvable,
): Promise<MessageReaction | undefined> {
  if (canBot('ADD_REACTIONS', msg?.channel)) {
    return msg?.react(emj)
  }
}

export function ButtonRow(buttons: MessageButtonOptions[]): MessageActionRow {
  return new MessageActionRow({
    components: buttons.map((opts) => new MessageButton(opts)),
  })
}

//// PRIVATE //////////////////////////////////////////////////////////////////

function getEmbedSelfAuthor(): MessageEmbedAuthor {
  return {
    name: client.user!.username,
    iconURL: client.user!.displayAvatarURL(),
  }
}

function getEmbedSelfThumbnail(): MessageEmbedThumbnail {
  return { url: client.user!.displayAvatarURL() }
}
