import { client } from '../'
// import { config } from '../../config'
import { debug, log } from '../../helpers'
import { clearOldData, clearOldBotData } from '../db/functions'
import { isMainThread } from 'worker_threads'
import { ActivityType } from 'discord.js'

export async function ready() {
  log(`${client.user!.tag} serving ${client.guilds.cache.size} servers.`)
  client.user!.setActivity(`DAILY MAINTENANCES (DEBUGGING)`, { type: ActivityType.Playing })
  if (isMainThread) {
    debug('community notifier...')
    import('../../modules/community/communityNotifier')
    debug('youtube notifier..')
    import('../../modules/youtubeNotifier')
    debug('twitcasting notifier..')
    import('../../modules/twitcastingNotifier')
    debug('chatrelayer')
    import('../../modules/livechat/chatRelayer')

    // setInterval(clearOldData, 24 * 60 * 60 * 100)
    // clearOldData()
    // clearOldBotData()
  }
}
