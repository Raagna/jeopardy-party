import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })
const games = new Map()

const id = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const clone = (x) => JSON.parse(JSON.stringify(x))
const connectedPlayers = (game) => [...game.players.values()].filter((player) => player.socketId)
function assignLowestConnected(game) {
  const players = connectedPlayers(game)
  if (!players.length) return null
  const low = Math.min(...players.map((player) => player.score))
  const choices = players.filter((player) => player.score === low)
  const player = choices[Math.floor(Math.random() * choices.length)]
  game.turnPlayerId = player.id
  game.answeringPlayerId = game.activeQuestion ? player.id : null
  game.buzzedPlayer = null
  game.buzzerOpen = false
  if (game.activeQuestion) game.activeQuestion.canPass = true
  return player
}

function publicGame(game) {
  return {
    code: game.code, status: game.status, board: game.boards[game.boardIndex], boardIndex: game.boardIndex, final: game.final,
    players: [...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId })),
    buzzerOpen: game.buzzerOpen, buzzedPlayer: game.buzzedPlayer,
    activeQuestion: game.activeQuestion, reveal: game.reveal, hostConnected: !!game.hostSocketId,
    finalResponses: [...game.finalResponses.entries()].map(([playerId, response]) => ({ playerId, ...response })),
    turnPlayerId: game.turnPlayerId, answeringPlayerId: game.answeringPlayerId, incorrectPlayerIds: game.incorrectPlayerIds,
    clueDeadline: game.clueDeadline
  }
}
function emitGame(game) { io.to(game.code).emit('game:update', publicGame(game)) }
function makeGame(code, config) {
  return {
    code, status: 'lobby', hostSocketId: null, players: new Map(),
    config: clone(config),
    boards: config.boards.map((board) => board.map((category) => ({ ...category, questions: category.questions.map((q, i) => ({ ...q, value: q.value || (i + 1) * 200, used: false })) }))),
    boardIndex: 0,
    final: config.final, buzzerOpen: false, buzzedPlayer: null, activeQuestion: null, reveal: false, finalResponses: new Map(), turnPlayerId: null, answeringPlayerId: null, incorrectPlayerIds: [], clueDeadline: null
  }
}

io.on('connection', (socket) => {
  socket.on('host:create', (config, ack) => {
    let code; do { code = id() } while (games.has(code))
    const game = makeGame(code, config); game.hostSocketId = socket.id; games.set(code, game)
    socket.join(code); ack?.({ ok: true, code, game: publicGame(game) })
  })
  socket.on('host:join', ({ code }, ack) => {
    const game = games.get(code?.toUpperCase()); if (!game) return ack?.({ ok: false, error: 'Game not found' })
    socket.data.controllerGame = game.code; socket.join(game.code); ack?.({ ok: true, game: publicGame(game) }); emitGame(game)
  })
  socket.on('player:join', ({ code, name, returningPlayerId }, ack) => {
    const game = games.get(code?.toUpperCase()); if (!game) return ack?.({ ok: false, error: 'Game not found' })
    const returning = game.players.get(returningPlayerId)
    if (returning && !returning.socketId) {
      returning.socketId = socket.id
      socket.join(game.code); socket.data.game = game.code; socket.data.player = returning.id
      ack?.({ ok: true, playerId: returning.id, game: publicGame(game), rejoined: true }); emitGame(game)
      return
    }
    if (game.status !== 'lobby') return ack?.({ ok: false, error: 'This game has already started. Re-enter the room code on the device you used to join.' })
    const clean = String(name || '').trim().slice(0, 20); if (!clean) return ack?.({ ok: false, error: 'Enter a name' })
    const player = { id: id(), name: clean, score: 0, socketId: socket.id }
    game.players.set(player.id, player); socket.join(game.code); socket.data.game = game.code; socket.data.player = player.id
    ack?.({ ok: true, playerId: player.id, game: publicGame(game) }); emitGame(game)
  })
  socket.on('host:action', ({ code, action, payload }) => {
    const game = games.get(code); if (!game || (game.hostSocketId !== socket.id && socket.data.controllerGame !== code)) return
    if (action === 'start') { game.status = 'playing'; const players=connectedPlayers(game); game.turnPlayerId=players[Math.floor(Math.random()*players.length)]?.id || null }
    if (action === 'select') {
      const { categoryIndex, questionIndex } = payload; const q = game.boards[game.boardIndex][categoryIndex]?.questions[questionIndex]
      if (q && !q.used) { game.activeQuestion = { categoryIndex, questionIndex, question: clone(q), canPass: true }; game.clueDeadline=Date.now()+30000; game.buzzedPlayer = null; game.answeringPlayerId = game.turnPlayerId; game.incorrectPlayerIds=[]; game.buzzerOpen = false; game.reveal = false }
    }
    if (action === 'buzzer') { game.buzzerOpen = !!payload.open; if (payload.open) game.buzzedPlayer = null }
    if (action === 'reveal') game.reveal = !game.reveal
    if (action === 'score') {
      const p = game.players.get(payload.playerId); const amount = Number(payload.amount) || 0
      if (p) p.score += amount
      // A correct regular-clue ruling immediately awards control and returns to the board.
      if (p && amount > 0 && game.status === 'playing' && game.activeQuestion && !game.activeQuestion.final) {
        const category = game.boards[game.boardIndex]?.[game.activeQuestion.categoryIndex]
        const question = category?.questions?.[game.activeQuestion.questionIndex]
        if (question) question.used = true
        game.turnPlayerId = p.id; game.answeringPlayerId = null; game.activeQuestion = null; game.clueDeadline=null
        game.buzzerOpen = false; game.buzzedPlayer = null; game.incorrectPlayerIds=[]; game.reveal = false
      } else if (p && amount < 0 && game.status === 'playing' && game.activeQuestion && !game.activeQuestion.final) {
        if (!game.incorrectPlayerIds.includes(p.id)) game.incorrectPlayerIds.push(p.id)
        game.answeringPlayerId=null; game.buzzedPlayer=null; game.buzzerOpen=true
        if (game.incorrectPlayerIds.length >= connectedPlayers(game).length) game.reveal=true
      }
    }
    if (action === 'close') {
      if (game.activeQuestion && !game.activeQuestion.final) {
        const category = game.boards[game.boardIndex]?.[game.activeQuestion.categoryIndex]
        const question = category?.questions?.[game.activeQuestion.questionIndex]
        if (question) question.used = true
      }
      game.activeQuestion = null; game.clueDeadline=null; game.buzzerOpen = false; game.buzzedPlayer = null; game.answeringPlayerId = null; game.reveal = false
      if (game.status === 'final') game.status = 'complete'
    }
    if (action === 'final') { game.status = 'final'; game.activeQuestion = { final: true, question: clone(game.final) }; game.clueDeadline=Date.now()+30000; game.reveal = false; game.buzzerOpen = false }
    if (action === 'revealFinalPlayer') { const response = game.finalResponses.get(payload.playerId); if (response) response.revealed = !response.revealed }
    if (action === 'nextBoard') { game.boardIndex = 1; game.activeQuestion = null; game.clueDeadline=null; game.buzzerOpen = false; game.buzzedPlayer = null; game.reveal = false }
    if (action === 'timeout') { const players=[...game.players.values()]; if(players.length){const low=Math.min(...players.map(p=>p.score)); const choices=players.filter(p=>p.score===low); const next=choices[Math.floor(Math.random()*choices.length)]; game.turnPlayerId=next.id; game.answeringPlayerId=game.activeQuestion?next.id:null; game.buzzerOpen=false; game.buzzedPlayer=null} }
    if (action === 'replay') {
      const reset = makeGame(game.code, game.config)
      reset.hostSocketId = game.hostSocketId
      reset.players = game.players
      for (const player of reset.players.values()) player.score = 0
      games.set(game.code, reset)
      emitGame(reset)
      return
    }
    emitGame(game)
  })
  socket.on('player:buzz', ({ code, playerId }) => {
    const game = games.get(code); if (!game || (!game.buzzerOpen && game.answeringPlayerId !== playerId) || game.buzzedPlayer || !game.players.has(playerId) || game.incorrectPlayerIds.includes(playerId)) return
    game.buzzedPlayer = playerId; game.answeringPlayerId = playerId; if(game.activeQuestion) game.activeQuestion.canPass=false; game.buzzerOpen = false; emitGame(game)
  })
  socket.on('player:pass', ({ code, playerId }) => {
    const game=games.get(code); if(!game || !game.activeQuestion || !game.activeQuestion.canPass || game.answeringPlayerId!==playerId) return
    game.answeringPlayerId=null; game.buzzedPlayer=null; game.buzzerOpen=true; emitGame(game)
  })
  socket.on('player:finalSubmit', ({ code, playerId, wager, response }, ack) => {
    const game = games.get(code); const player = game?.players.get(playerId)
    if (!game || !player || game.status !== 'final' || game.finalResponses.has(playerId)) return ack?.({ ok: false, error: 'Final response is not available.' })
    const amount = Math.max(0, Math.min(Number(wager) || 0, Math.max(0, player.score)))
    const text = String(response || '').trim().slice(0, 500)
    if (!text) return ack?.({ ok: false, error: 'Enter your response.' })
    game.finalResponses.set(playerId, { wager: amount, response: text, revealed: false })
    ack?.({ ok: true }); emitGame(game)
  })
  socket.on('disconnect', () => {
    for (const game of games.values()) {
      if (game.hostSocketId === socket.id) { game.hostSocketId = null; emitGame(game) }
      for (const [pid, player] of game.players) if (player.socketId === socket.id) {
        player.socketId = null
        if (game.turnPlayerId === pid || game.answeringPlayerId === pid || game.buzzedPlayer === pid) assignLowestConnected(game)
        emitGame(game)
      }
    }
  })
})

app.get('/health', (_, res) => res.json({ ok: true, games: games.size }))
httpServer.listen(3001, () => console.log('Jeopardy server listening on http://localhost:3001'))
