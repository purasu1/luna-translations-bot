import { client } from '../'
// import { config } from '../../config'
import { log } from '../../helpers'
import { clearOldData, clearOldBotData } from '../db/functions'
import { isMainThread } from 'worker_threads'

export async function ready() {
  log(`${client.user!.tag} serving ${client.guilds.cache.size} servers.`)
  client.user!.setActivity(`MAINTENANCE, NO RELAY`, { type: 'PLAYING' })
  if (isMainThread) {
    console.log('community notifier...')
    import('../../modules/community/communityNotifier')
    console.log('youtube notifier..')
    import('../../modules/youtubeNotifier')
    console.log('twitcasting notifier..')
    import('../../modules/twitcastingNotifier')
    console.log('chatrelayer')
    import('../../modules/livechat/chatRelayer')

    setInterval(clearOldData, 24 * 60 * 60 * 100)
    clearOldData()
    clearOldBotData()
  }
}
