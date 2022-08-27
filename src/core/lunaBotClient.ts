import { Client, Intents } from 'discord.js'
import { Command, loadAllCommands, loadAllEvents } from '../helpers/discord'
import { isMainThread } from 'worker_threads'
import { Map } from 'immutable'
import './registerSlashCommands'

export const commands: Map<string, Command> = isMainThread ? loadAllCommands() : Map()

export const client = new Client({
  intents: new Intents(['GUILDS']),
  retryLimit: 5,
  restRequestTimeout: 30000,
})

if (isMainThread) {
  loadAllEvents().forEach((callback, evtName) => client.on(evtName, callback))
}
