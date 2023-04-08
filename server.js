const express = require('express')
const app = express()
const server = require('http').Server(app)
const io = require('socket.io')(server)
const {Pool} = require('pg');

const pool = new Pool({
  host: "localhost",
  user: "postgres",
  port: 5432,
  database: "chats",
  max: 20,
  connectionTimeoutMillis: 0,
  idleTimeoutMillis: 10
})


async function addChat(name, code) {
  const client = await pool.connect()
  await client.query('delete from public.chats where name = $1', [name])
  await client.query('INSERT INTO public.chats (name, code) VALUES ($1, $2)', [name, code])
  client.release()
}

async function createRoom(name) {
  const client = await pool.connect()
  await client.query('INSERT INTO public.chats (name) VALUES ($1)', [name])
  client.release()
}

async function getChat(name) {
  const client = await pool.connect()
  let res = await client.query('select code from public.chats where name = $1', [name])
  client.release()
  return res.rows[0];
}

async function getRooms() {
  const client = await pool.connect()
  let res = await client.query('select name from chats')
  client.release()
  return res.rows;
}

app.set('views', './views')
app.set('view engine', 'ejs')
app.use(express.static('public'))
app.use(express.urlencoded({ extended: true }))

let rooms = { }

function rewrite(r) {
  let line = 'rooms = {'
  for (let i = 0; i < r.length - 1; i++) {
    let tmp = '"'
    tmp += r[i].name + '": {"users":{}}, '
    console.log(tmp)
    line += tmp
  }
  line += '"' + r[r.length - 1].name + '": {"users":{}}}'
  console.log(line)
  eval(line)

}

getRooms().then(r => {
  if (r.length) {
    rewrite(r)
  }
})

app.get('/', (req, res) => {
  res.render('index', { rooms: rooms })
})

app.post('/room', (req, res) => {
  if (rooms[req.body.room] != null) {
    return res.redirect('/')
  }
  rooms[req.body.room] = { users: {} }
  res.redirect(req.body.room)
  io.emit('room-created', req.body.room)
  createRoom(req.body.room).then()
})

app.get('/:room', (req, res) => {

  if (rooms[req.params.room] == null) {
    return res.redirect('/')
  }
  getChat(req.params.room).then(r => {
    let tmp;
    if (r) tmp = r.code;
  res.render('room', { roomName: req.params.room, chat: tmp })
  })
})

server.listen(3000)

io.on('connection', socket => {
  socket.on('new-user', (room, name) => {
    socket.join(room)
    rooms[room].users[socket.id] = name
    socket.to(room).broadcast.emit('user-connected', name)
  })
  socket.on('send-chat-message', (room, message) => {
    socket.to(room).broadcast.emit('chat-message', { message: message, name: rooms[room].users[socket.id] })
  })
  socket.on('disconnect', () => {
    getUserRooms(socket).forEach(room => {
      socket.to(room).broadcast.emit('user-disconnected', rooms[room].users[socket.id])
      delete rooms[room].users[socket.id]
    })
  })
  socket.on('save', (room_name, messages) => {
    addChat(room_name, messages).then();
  })
})

function getUserRooms(socket) {
  return Object.entries(rooms).reduce((names, [name, room]) => {
    if (room.users[socket.id] != null) names.push(name)
    return names
  }, [])
}