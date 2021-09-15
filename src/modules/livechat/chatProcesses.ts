import { MasterchatAgent } from 'masterchat'
import { VideoId } from '../holodex/frames'

/** Returns a singleton of the chat process for a given video ID */
export  function getChatProcess (videoId: VideoId, channelId: string): ChatProcess {
  return chatProcesses[videoId] ??= new MasterchatAgent (videoId, channelId, {isLive:true})
}

export function chatProcessExists (videoId: VideoId): boolean {
  return chatProcesses[videoId] != undefined
}

export function deleteChatProcess (videoId: VideoId): void {
  delete chatProcesses[videoId]
}

///////////////////////////////////////////////////////////////////////////////

type ChatProcess = MasterchatAgent

const chatProcesses: Record<VideoId, ChatProcess> = {}