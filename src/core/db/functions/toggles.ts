import { CommandInteraction } from 'discord.js'
import { createEmbedMessage, reply } from '../../../helpers/discord'
import { SettingToggle } from '../models/GuildSettings'
import { getSettings, updateSettings } from './guildSettings'

export function toggleSetting(props: ToggleProps): void {
  const settings = getSettings(props.intr)
  const current = settings[props.setting]
  const notice = current === true ? props.disable : props.enable

  updateSettings(props.intr, { [props.setting]: !current })
  reply(props.intr, createEmbedMessage(notice))
}

///////////////////////////////////////////////////////////////////////////////

interface ToggleProps {
  intr: CommandInteraction
  setting: SettingToggle
  enable: string
  disable: string
}
