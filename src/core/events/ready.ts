import { client } from '../'
// import { config } from '../../config'
import { log } from '../../helpers'
import { clearOldData, clearOldBotData } from '../db/functions'
import { isMainThread } from 'worker_threads'

export async function ready() {
  log(`${client.user!.tag} serving ${client.guilds.cache.size} servers.`)
  client.user!.setActivity(`MAINTENANCE, NO RELAY`, { type: 'PLAYING' })
  if (isMainThread) {
    import('../../modules/community/communityNotifier')
    import('../../modules/youtubeNotifier')
    import('../../modules/twitcastingNotifier')
    import('../../modules/livechat/chatRelayer')

    setInterval(clearOldData, 24 * 60 * 60 * 100)
    clearOldData()
    clearOldBotData()
  }
}
