import EventEmitter from 'events'
import { isEmpty } from 'ramda'
import { DexFrame, getFrameList, isPublic } from './frames'
import { isSupported } from '../../core/db/streamers'
import { debug, removeDupeObjects } from '../../helpers'

export const frameEmitter = FrameEmitter()

///////////////////////////////////////////////////////////////////////////////

function FrameEmitter(): EventEmitter {
  const emitter = new EventEmitter()
  continuouslyEmitNewFrames(emitter)
  return emitter
}

async function continuouslyEmitNewFrames(
  emitter: EventEmitter,
  previousFrames: DexFrame[] = [],
): Promise<void> {
  debug('getting frames...')
  const allFrames = await getFrameList()
  debug('got frames!')
  const newFrames = removeDupeObjects(
    allFrames?.filter(
      (frame) => isNew(frame, previousFrames) && !isFreeChat(frame) && isPublic(frame),
    ) ?? [],
  )

  newFrames.forEach((frame) => {
    if (isSupported(frame.channel.id)) {
      emitter.emit('frame', frame)
    }
  })

  const currentFrames = isEmpty(allFrames) ? previousFrames : allFrames
  setTimeout(() => continuouslyEmitNewFrames(emitter, currentFrames), 30000)
}

function isNew(frame: DexFrame, previousFrames: DexFrame[]): boolean {
  return !Boolean(previousFrames.find((pf) => pf.id === frame.id && pf.status === frame.status))
}

function isFreeChat(frame: DexFrame): boolean {
  // polka and kson, will improve this later
  const exceptions = [
    'UCK9V2B22uJYu3N7eR_BT9QA',
    'UC9ruVYPv7yJmV0Rh0NKA-Lw',
    'UshZgOv3YDEs-ZnZWDYVwJdmA',
    'UCAWSyEs_Io8MtpY3m-zqILA',
    'UCZgOv3YDEs-ZnZWDYVwJdmA',
    'UCl_gCybOJRIgOXw6Qb4qJzQ',
    'UCa9Y57gfeY0Zro_noHRVrnw',
  ]
  const isException = exceptions.some((ch) => ch === frame.channel.id)
  const isFreeChat = ['freechat', 'free chat', 'freeechat', 'フリーチャット'].some((pattern) =>
    frame.title.toLowerCase().includes(pattern),
  )
  return isFreeChat && !isException && frame.status !== 'live'
}
