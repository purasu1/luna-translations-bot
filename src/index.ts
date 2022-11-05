/**
 * LUNA'S TRANSLATIONS DISCORD BOT
 */
Error.stackTraceLimit = Infinity
import * as dotenv from 'dotenv'
dotenv.config({ path: __dirname + '/../.env' })
import { config } from './config'
import { client } from './core/'
import mongoose from 'mongoose'
import { debug } from './helpers'

const MONGODB_URL = process.env.MONGODB_URL ?? 'mongodb://localhost/luna'

mongoose.connect(MONGODB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useFindAndModify: false,
})

process.on('uncaughtException', function (err) {
  debug('Uncaught exception: ' + err)
  client.guilds.cache.find((g) => g.id === '')
  const ch = client.channels.cache.get('798600485652398120')
  ch?.isTextBased() && ch.send('<@150696503428644864> UNCAUGHT EXCEPTION')

  debug(err.stack)
})

client.login(config.token)
