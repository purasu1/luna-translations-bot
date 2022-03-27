import { Masterchat } from 'masterchat'
import { VideoId } from '../holodex/frames'

/** Returns a singleton of the chat process for a given video ID */
export function getChatProcess(videoId: VideoId, channelId: string): ChatProcess {
  return (chatProcesses[videoId] ??= new Masterchat(videoId, channelId, { mode: 'live' }))
}

export function chatProcessExists(videoId: VideoId): boolean {
  return chatProcesses[videoId] != undefined
}

export function deleteChatProcess(videoId: VideoId): void {
  delete chatProcesses[videoId]
}

///////////////////////////////////////////////////////////////////////////////

type ChatProcess = Masterchat

const chatProcesses: Record<VideoId, ChatProcess> = {}
