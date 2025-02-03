const socket = io();
let currentRoom = null;
let isJudge = false;
let isHost = false;
let countdownInterval = null;

console.log("DEBUG: Socket.IO client connesso.");

// Riferimenti agli elementi DOM
const registrationSection = document.getElementById('registrationSection');
const roomSection = document.getElementById('roomSection');
const gameSection = document.getElementById('gameSection');
const startGameBtn = document.getElementById('startGameBtn');
const pendingListDiv = document.getElementById('pendingList');
const approvedListDiv = document.getElementById('approvedList');

// Registrazione
document.getElementById('registrationForm').addEventListener('submit', (e) => {
  e.preventDefault();
  let username = document.getElementById('usernameInput').value;
  console.log(`DEBUG: Tentativo di registrazione con username: ${username}`);
  socket.emit('register', username, (response) => {
    console.log("DEBUG: Risposta registrazione:", response);
    if (response.success) {
      registrationSection.style.display = 'none';
      roomSection.style.display = 'block';
    }
  });
});

// Creazione della stanza (chi crea diventa host)
document.getElementById('createRoomForm').addEventListener('submit', (e) => {
  e.preventDefault();
  let roomName = document.getElementById('roomNameInput').value;
  console.log(`DEBUG: Tentativo di creazione stanza con nome: ${roomName}`);
  socket.emit('createRoom', roomName, (response) => {
    console.log("DEBUG: Risposta createRoom:", response);
    if (response.success) {
      currentRoom = response.roomId;
      isHost = true;
      roomSection.style.display = 'none';
      gameSection.style.display = 'block';
      document.getElementById('roomIdDisplay').textContent = 'Room ID: ' + currentRoom;
      // Mostra il pulsante Avvia Gioco e le liste per l'host
      startGameBtn.style.display = 'inline-block';
      pendingListDiv.style.display = 'block';
      approvedListDiv.style.display = 'block';
    } else {
      console.error("DEBUG: Errore nella creazione stanza:", response.message);
    }
  });
});

// Ingresso in stanza esistente (l'utente entra in pending)
document.getElementById('joinRoomForm').addEventListener('submit', (e) => {
  e.preventDefault();
  let roomId = document.getElementById('joinRoomInput').value;
  console.log(`DEBUG: Tentativo di ingresso nella stanza: ${roomId}`);
  socket.emit('joinRoom', roomId, (response) => {
    console.log("DEBUG: Risposta joinRoom:", response);
    if (response.success && response.pending) {
      currentRoom = roomId;
      roomSection.innerHTML = `<h2>In attesa di approvazione dall'host...</h2>`;
    } else if (!response.success) {
      alert(response.message);
      console.error("DEBUG: Errore in joinRoom:", response.message);
    }
  });
});

// Ricezione dell'approvazione o rifiuto di ingresso
socket.on('joinApproved', (data) => {
  console.log("DEBUG: Ingresso approvato:", data);
  roomSection.style.display = 'none';
  gameSection.style.display = 'block';
});
socket.on('joinRejected', (data) => {
  console.log("DEBUG: Ingresso rifiutato:", data);
  alert(data.message);
  roomSection.style.display = 'block';
});

// Avvio del gioco (disponibile solo per l'host)
startGameBtn.addEventListener('click', () => {
  console.log("DEBUG: Avvio gioco per stanza:", currentRoom);
  socket.emit('startGame', currentRoom, (response) => {
    console.log("DEBUG: Risposta startGame:", response);
    if (!response.success) {
      alert(response.message);
      console.error("DEBUG: Errore in startGame:", response.message);
    }
  });
});

// Funzione per avviare il countdown
function startCountdown(duration) {
  const timerDiv = document.getElementById('timer');
  let countdown = duration;
  timerDiv.textContent = `Tempo rimanente: ${countdown}s`;
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    countdown--;
    timerDiv.textContent = `Tempo rimanente: ${countdown}s`;
    if (countdown <= 0) {
      clearInterval(countdownInterval);
    }
  }, 1000);
}

// Ricezione dell'inizio del nuovo round
socket.on('newRound', (data) => {
  console.log("DEBUG: Nuovo round ricevuto:", data);
  let gameArea = document.getElementById('gameArea');
  gameArea.innerHTML = '';
  
  startCountdown(data.roundDuration);

  let blackCardDiv = document.createElement('div');
  blackCardDiv.className = 'black-card';
  blackCardDiv.textContent = data.blackCard;
  gameArea.appendChild(blackCardDiv);
  
  isJudge = data.isJudge;
  if (isJudge) {
    let judgeNotice = document.createElement('p');
    judgeNotice.textContent = 'Sei il giudice questo round. Attendi le carte dagli altri giocatori.';
    gameArea.appendChild(judgeNotice);
  } else {
    let playerNotice = document.createElement('p');
    playerNotice.textContent = `Seleziona ${data.pick} carta(e) dalla tua mano e conferma la scelta.`;
    gameArea.appendChild(playerNotice);
    
    let handDiv = document.createElement('div');
    handDiv.className = 'hand';
    let selectedCards = [];
    data.hand.forEach(card => {
      let cardDiv = document.createElement('div');
      cardDiv.className = 'white-card';
      cardDiv.textContent = card;
      cardDiv.addEventListener('click', () => {
        if (cardDiv.classList.contains('selected')) {
          cardDiv.classList.remove('selected');
          selectedCards = selectedCards.filter(c => c !== card);
        } else {
          if (selectedCards.length < data.pick) {
            cardDiv.classList.add('selected');
            selectedCards.push(card);
          }
        }
        // Abilita o disabilita il pulsante di conferma in base al numero di carte selezionate
        if (selectedCards.length === data.pick) {
          confirmBtn.disabled = false;
        } else {
          confirmBtn.disabled = true;
        }
      });
      handDiv.appendChild(cardDiv);
    });
    gameArea.appendChild(handDiv);
    
    // Pulsante per confermare la scelta
    let confirmBtn = document.createElement('button');
    confirmBtn.id = 'confirmPlayBtn';
    confirmBtn.textContent = 'Conferma Carta';
    confirmBtn.disabled = true;
    handDiv.appendChild(confirmBtn);
    confirmBtn.addEventListener('click', () => {
      console.log("DEBUG: Conferma invio carte:", selectedCards);
      socket.emit('playCard', currentRoom, selectedCards, (response) => {
        console.log("DEBUG: Risposta playCard:", response);
        if (!response.success) {
          alert(response.message);
          console.error("DEBUG: Errore in playCard:", response.message);
        } else {
          confirmBtn.remove();
          handDiv.querySelectorAll('.selected').forEach(cardElem => {
            cardElem.style.opacity = '0.5';
            cardElem.style.pointerEvents = 'none';
          });
        }
      });
    });
  }
});

// Se il giudice riceve le sottomissioni (con dati anonimi)
socket.on('chooseWinner', (submissions) => {
  console.log("DEBUG: Ricevuto chooseWinner:", submissions);
  if (isJudge) {
    let gameArea = document.getElementById('gameArea');
    let submissionDiv = document.createElement('div');
    submissionDiv.className = 'submissions';
    let info = document.createElement('p');
    info.textContent = 'Seleziona il vincitore:';
    submissionDiv.appendChild(info);
    let selectedSubmissionId = null;
    submissions.forEach(sub => {
      let subCard = document.createElement('div');
      subCard.className = 'white-card';
      // Se ci sono più carte, unirle con " | "
      subCard.textContent = sub.cards.join(' | ');
      subCard.addEventListener('click', () => {
        submissionDiv.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
        subCard.classList.add('selected');
        selectedSubmissionId = sub.playerId;
        let confirmWinnerBtn = document.getElementById('confirmWinnerBtn');
        if (!confirmWinnerBtn) {
          confirmWinnerBtn = document.createElement('button');
          confirmWinnerBtn.id = 'confirmWinnerBtn';
          confirmWinnerBtn.textContent = 'Conferma Vincitore';
          submissionDiv.appendChild(confirmWinnerBtn);
          confirmWinnerBtn.addEventListener('click', () => {
            console.log("DEBUG: Giudice conferma vincitore:", selectedSubmissionId);
            socket.emit('chooseWinner', currentRoom, selectedSubmissionId, (response) => {
              console.log("DEBUG: Risposta chooseWinner:", response);
              if (!response.success) {
                alert(response.message);
                console.error("DEBUG: Errore in chooseWinner:", response.message);
              }
            });
          });
        }
      });
      submissionDiv.appendChild(subCard);
    });
    gameArea.appendChild(submissionDiv);
  }
});

// Aggiornamento della lista dei giocatori approvati (per l'host)
socket.on('roomUpdate', (room) => {
  console.log("DEBUG: Ricevuto roomUpdate:", room);
  if (isHost) {
    approvedListDiv.innerHTML = '<h3>Giocatori Approvati:</h3>';
    room.players.forEach(player => {
      let p = document.createElement('p');
      p.textContent = player.username;
      approvedListDiv.appendChild(p);
    });
  }
});

// Aggiornamento della lista pending (per l'host)
socket.on('pendingUpdate', (pendingList) => {
  console.log("DEBUG: Ricevuto pendingUpdate:", pendingList);
  if (isHost) {
    pendingListDiv.innerHTML = '<h3>Richieste di Ingresso:</h3>';
    pendingList.forEach(pending => {
      let div = document.createElement('div');
      div.textContent = pending.username;
      let approveBtn = document.createElement('button');
      approveBtn.textContent = 'Approva';
      approveBtn.addEventListener('click', () => {
         console.log(`DEBUG: Approvazione richiesta per ${pending.id}`);
         socket.emit('approveJoin', { roomId: currentRoom, pendingId: pending.id }, (response) => {
           console.log("DEBUG: Risposta approveJoin:", response);
           if (!response.success) {
             alert(response.message);
           }
         });
      });
      let rejectBtn = document.createElement('button');
      rejectBtn.textContent = 'Rifiuta';
      rejectBtn.addEventListener('click', () => {
         console.log(`DEBUG: Rifiuto richiesta per ${pending.id}`);
         socket.emit('rejectJoin', { roomId: currentRoom, pendingId: pending.id }, (response) => {
           console.log("DEBUG: Risposta rejectJoin:", response);
           if (!response.success) {
             alert(response.message);
           }
         });
      });
      div.appendChild(approveBtn);
      div.appendChild(rejectBtn);
      pendingListDiv.appendChild(div);
    });
  }
});

// Notifica generica
socket.on('message', (msg) => {
  console.log("DEBUG: Ricevuto message:", msg);
  alert(msg);
});