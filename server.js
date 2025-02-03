// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');

// Carica le carte dal file JSON
let whiteCards = [];
let blackCards = [];

try {
  const data = JSON.parse(fs.readFileSync('./cards.json', 'utf8'));
  whiteCards = data.white;
  blackCards = data.black; // array di oggetti {text, pick}
  console.log("DEBUG: Carte caricate correttamente.");
} catch (err) {
  console.error("DEBUG: Errore nel caricamento di cards.json:", err);
}

// Servi i file statici dalla cartella "public"
app.use(express.static('public'));

// Oggetto globale per memorizzare le stanze
let rooms = {};

// Funzione per generare un ID stanza unico (6 caratteri)
function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// (Qui dovresti avere gli eventi per registrazione, join, approvazione e rifiuto dell'ingresso)
// Per brevità, includiamo le sezioni principali aggiornate:

// Evento di registrazione, creazione stanza, joinRoom, approveJoin e rejectJoin
io.on('connection', socket => {
  console.log(`DEBUG: Nuovo utente connesso: ${socket.id}`);

  socket.on('register', (username, callback) => {
    socket.username = username;
    console.log(`DEBUG: Utente registrato: ${username} (${socket.id})`);
    callback({ success: true, username });
  });

  // Creazione della stanza (chi crea diventa host)
  socket.on('createRoom', (roomName, callback) => {
    console.log(`DEBUG: Richiesta di creazione stanza. Nome stanza: ${roomName}`);
    let roomId = generateRoomId();
    rooms[roomId] = {
      roomName: roomName,
      host: socket.id,          // il creatore è l'host
      pending: [],              // lista dei giocatori in attesa di approvazione
      players: [],
      judgeIndex: 0,            // il primo giocatore diventerà giudice
      currentBlackCard: null,
      submissions: [],
      roundTimer: null
    };
    socket.join(roomId);
    let player = { id: socket.id, username: socket.username, hand: [] };
    rooms[roomId].players.push(player);
    console.log(`DEBUG: Stanza creata: ${roomId} (${roomName}). Host: ${socket.username}`);
    callback({ success: true, roomId });
    io.to(roomId).emit('roomUpdate', rooms[roomId]);
    console.log(`DEBUG: Emesso roomUpdate per la stanza ${roomId}`);
  });

  // Ingresso in una stanza esistente: il giocatore viene aggiunto in pending
  socket.on('joinRoom', (roomId, callback) => {
    console.log(`DEBUG: Richiesta di ingresso nella stanza: ${roomId}`);
    if (rooms[roomId]) {
      let pendingPlayer = { id: socket.id, username: socket.username };
      rooms[roomId].pending.push(pendingPlayer);
      console.log(`DEBUG: Utente ${socket.username} (${socket.id}) in attesa di approvazione nella stanza ${roomId}`);
      callback({ success: true, pending: true, roomId });
      // Notifica l'host con l'aggiornamento della lista pending
      if (rooms[roomId].host) {
        io.to(rooms[roomId].host).emit('pendingUpdate', rooms[roomId].pending);
      }
    } else {
      console.log(`DEBUG: Stanza ${roomId} non trovata.`);
      callback({ success: false, message: 'Stanza non trovata' });
    }
  });

  // Approvazione dell'ingresso da parte dell'host
  socket.on('approveJoin', (data, callback) => {
    // data: { roomId, pendingId }
    console.log(`DEBUG: Approvazione richiesta per utente ${data.pendingId} nella stanza ${data.roomId}`);
    let room = rooms[data.roomId];
    if (!room) {
      callback({ success: false, message: 'Stanza non trovata' });
      return;
    }
    if (room.host !== socket.id) {
      callback({ success: false, message: 'Solo l\'host può approvare l\'ingresso' });
      return;
    }
    let index = room.pending.findIndex(p => p.id === data.pendingId);
    if (index === -1) {
      callback({ success: false, message: 'Utente non trovato nella lista pending' });
      return;
    }
    let pendingPlayer = room.pending.splice(index, 1)[0];
    room.players.push({ id: pendingPlayer.id, username: pendingPlayer.username, hand: [] });
    let pendingSocket = io.sockets.sockets.get(pendingPlayer.id);
    if (pendingSocket) {
      pendingSocket.join(data.roomId);
      pendingSocket.emit('joinApproved', { roomId: data.roomId });
    }
    callback({ success: true });
    io.to(room.host).emit('pendingUpdate', room.pending);
    io.to(data.roomId).emit('roomUpdate', room);
  });

  // Rifiuto dell'ingresso da parte dell'host
  socket.on('rejectJoin', (data, callback) => {
    // data: { roomId, pendingId }
    console.log(`DEBUG: Rifiuto ingresso per utente ${data.pendingId} nella stanza ${data.roomId}`);
    let room = rooms[data.roomId];
    if (!room) {
      callback({ success: false, message: 'Stanza non trovata' });
      return;
    }
    if (room.host !== socket.id) {
      callback({ success: false, message: 'Solo l\'host può rifiutare l\'ingresso' });
      return;
    }
    let index = room.pending.findIndex(p => p.id === data.pendingId);
    if (index === -1) {
      callback({ success: false, message: 'Utente non trovato nella lista pending' });
      return;
    }
    let pendingPlayer = room.pending.splice(index, 1)[0];
    let pendingSocket = io.sockets.sockets.get(pendingPlayer.id);
    if (pendingSocket) {
      pendingSocket.emit('joinRejected', { roomId: data.roomId, message: 'Il tuo ingresso è stato rifiutato dall\'host' });
    }
    callback({ success: true });
    io.to(room.host).emit('pendingUpdate', room.pending);
  });

  // Avvio del gioco (disponibile solo se il numero minimo di giocatori è raggiunto)
  socket.on('startGame', (roomId, callback) => {
    console.log(`DEBUG: Avvio gioco in stanza: ${roomId}`);
    if (!rooms[roomId]) {
      callback({ success: false, message: 'Stanza non trovata' });
      return;
    }
    let room = rooms[roomId];
    if (room.players.length < 3) {
      console.log("DEBUG: Numero minimo di giocatori non raggiunto.");
      callback({ success: false, message: 'Numero minimo di giocatori non raggiunto (minimo 3)' });
      return;
    }
    // Distribuisci 5 carte bianche a ogni giocatore
    room.players.forEach(player => {
      player.hand = drawWhiteCards(5);
      console.log(`DEBUG: Distribuite 5 carte a ${player.username}`);
    });
    callback({ success: true });
    startRound(roomId);
  });

  // Evento playCard: ora riceve un array di carte selezionate
  socket.on('playCard', (roomId, selectedCards, callback) => {
    console.log(`DEBUG: playCard ricevuto da ${socket.username} (${socket.id}) per le carte: ${selectedCards}`);
    let room = rooms[roomId];
    if (!room) {
      callback({ success: false, message: 'Stanza non trovata' });
      return;
    }
    let player = room.players.find(p => p.id === socket.id);
    if (!player) {
      callback({ success: false, message: 'Giocatore non trovato nella stanza' });
      return;
    }
    if (room.players[room.judgeIndex].id === socket.id) {
      callback({ success: false, message: 'Il giudice non può giocare carte' });
      return;
    }
    if (room.submissions.find(s => s.playerId === socket.id)) {
      callback({ success: false, message: 'Hai già giocato carte per questo round' });
      return;
    }
    if (!Array.isArray(selectedCards) || selectedCards.length !== room.currentBlackCard.pick) {
      callback({ success: false, message: `Devi selezionare ${room.currentBlackCard.pick} carta(e)` });
      return;
    }
    // Rimuovi le carte selezionate dalla mano del giocatore
    selectedCards.forEach(card => {
      let idx = player.hand.indexOf(card);
      if (idx !== -1) {
        player.hand.splice(idx, 1);
      }
    });
    // Salva la sottomissione
    room.submissions.push({ playerId: socket.id, cards: selectedCards, username: player.username });
    console.log(`DEBUG: ${socket.username} ha giocato le carte: ${selectedCards}`);
    callback({ success: true });
    // Se tutti i giocatori (eccetto il giudice) hanno giocato, notifica il giudice
    let nonJudgeCount = room.players.length - 1;
    if (room.submissions.length === nonJudgeCount) {
      console.log("DEBUG: Tutti i giocatori hanno giocato. Notifico il giudice.");
      // Anonimizza le sottomissioni per il giudice (non mostrare i nomi)
      const submissionsAnonymized = room.submissions.map(sub => ({
        playerId: sub.playerId,
        cards: sub.cards
      }));
      io.to(room.players[room.judgeIndex].id).emit('chooseWinner', submissionsAnonymized);
      if (room.roundTimer) {
        clearTimeout(room.roundTimer);
        room.roundTimer = null;
        console.log("DEBUG: Timer del round cancellato.");
      }
    }
  });

  // Evento chooseWinner (il giudice conferma il vincitore)
  socket.on('chooseWinner', (roomId, winnerPlayerId, callback) => {
    console.log(`DEBUG: Il giudice ${socket.username} sta scegliendo il vincitore nella stanza ${roomId}`);
    let room = rooms[roomId];
    if (!room) {
      callback({ success: false, message: 'Stanza non trovata' });
      return;
    }
    if (room.players[room.judgeIndex].id !== socket.id) {
      callback({ success: false, message: 'Solo il giudice può scegliere il vincitore' });
      return;
    }
    let submission = room.submissions.find(s => s.playerId === winnerPlayerId);
    if (!submission) {
      callback({ success: false, message: 'Il vincitore scelto non ha inviato una carta valida' });
      return;
    }
    io.to(roomId).emit('roundWinner', { winner: submission, blackCard: room.currentBlackCard.text });
    console.log(`DEBUG: Vincitore scelto: ${submission.username} con la carta/e: ${submission.cards}`);
    callback({ success: true });
    // Prepara il round successivo:
    room.judgeIndex = (room.judgeIndex + 1) % room.players.length;
    room.submissions = [];
    room.players.forEach(player => {
      while (player.hand.length < 5) {
        player.hand.push(whiteCards[Math.floor(Math.random() * whiteCards.length)]);
      }
    });
    console.log("DEBUG: Preparazione per il prossimo round.");
    setTimeout(() => {
      startRound(roomId);
    }, 5000);
  });

  // Gestione della disconnessione
  socket.on('disconnect', () => {
    console.log(`DEBUG: Utente disconnesso: ${socket.id}`);
    for (let roomId in rooms) {
      let room = rooms[roomId];
      // Rimuovo dalla lista dei players
      let playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        console.log(`DEBUG: Rimuovo l'utente ${socket.id} dalla stanza ${roomId}`);
        room.players.splice(playerIndex, 1);
        if (room.players.length === 0) {
          console.log(`DEBUG: La stanza ${roomId} è vuota e viene eliminata.`);
          delete rooms[roomId];
        } else {
          if (room.judgeIndex >= room.players.length) {
            room.judgeIndex = 0;
          }
          io.to(roomId).emit('roomUpdate', room);
          console.log(`DEBUG: Emesso roomUpdate per la stanza ${roomId}`);
        }
      }
      // Rimuovo dalla lista pending, se presente
      let pendingIndex = room.pending.findIndex(p => p.id === socket.id);
      if (pendingIndex !== -1) {
        room.pending.splice(pendingIndex, 1);
        io.to(room.host).emit('pendingUpdate', room.pending);
      }
    }
  });
});

const port = process.env.PORT || 3000;
http.listen(port, () => {
  console.log(`DEBUG: Server in ascolto sulla porta ${port}`);
});