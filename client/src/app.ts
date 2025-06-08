const socket = io('http://localhost:3000')

let myPlayerId = ''
let myPlayerName = ''
// 山札の残り枚数
let deckRemaining = 0

function getElement<T extends HTMLElement>(id: string, tag: string): T {
  let elem = document.getElementById(id) as T
  if (!elem) {
    elem = document.createElement(tag) as T
    elem.id = id
    document.getElementById('player-ui')?.appendChild(elem)
  }
  return elem
}

// --- カード描画関数 ---
function renderCard(elem: HTMLElement, card: { suit: string, value: number } | null, onClick?: () => void) {
  elem.className = 'card'
  if (!card) {
    elem.textContent = '（なし）'
    elem.onclick = null
    elem.style.cursor = ''
    elem.style.background = ''
  } else if (card.suit === 'JOKER') {
    elem.textContent = 'JOKER'
    elem.classList.add('joker')
    elem.onclick = onClick || null
  } else {
    const suitMap: { [key: string]: string } = { S: '♠', H: '♥', D: '♦', C: '♣' }
    const valueMap: { [key: number]: string } = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }
    const valueStr = valueMap[card.value] || card.value.toString()
    elem.textContent = `${suitMap[card.suit] || card.suit} ${valueStr}`
    if (card.suit === 'H' || card.suit === 'D') {
      elem.classList.add('red') // ハート・ダイヤは赤色
    }
    elem.onclick = onClick || null
  }
  elem.style.fontSize = '2.5rem'
  elem.style.padding = '32px'
  elem.style.borderRadius = '16px'
  elem.style.textAlign = 'center'
  elem.style.userSelect = 'none'
  elem.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'
  elem.style.margin = '16px auto'
  elem.style.width = '180px'
}

/**
 * 通知メッセージを表示する(手を置いた結果や誤タッチなど)
 * TODO: 別の表示方法を検討する
 * @param message 通知メッセージ
 * @param type
 */
function showNotification(message: string, type: 'mistake' | 'success' = 'success') {
  const area = getElement<HTMLDivElement>('notification-area', 'div')
  const note = document.createElement('div')
  note.className = 'notification ' + type
  note.textContent = message
  area.appendChild(note)
  // 2秒後にフェードアウトさせる
  setTimeout(() => {
    note.style.opacity = '0'
    note.style.transform = 'translateY(20px)'
    setTimeout(() => area.removeChild(note), 400)
  }, 2000)
}

/**
 * 
 * @param info プレイヤー情報(IDと名前)
 */
function handlePlayerInfo(info: { id: string, name: string }) {
  myPlayerId = info.id
  myPlayerName = info.name
  getElement<HTMLParagraphElement>('server-message', 'p').textContent = `あなたは「${myPlayerName}」です`
}

function handlePlayerList(players: { id: string, name: string }[]) {
  console.log('受信: playerList', players)
  getElement<HTMLParagraphElement>('player-list', 'p').textContent = '参加中プレイヤー: ' + players.map(p => p.name).join(', ')
}

function handleDeckInfo(info: { remaining: number }) {
  deckRemaining = info.remaining
  getElement<HTMLParagraphElement>('deck-info', 'p').textContent = `山札の残り枚数: ${info.remaining}`
}

function handleHandInfo(hands: { [id: string]: number }) {
  const myHand = hands[myPlayerId] || 0
  getElement<HTMLParagraphElement>('hand-info', 'p').textContent = `あなたの手札: ${myHand}枚`

  // 全員分の手札枚数表示
  const playerListElem = document.getElementById('player-list')
  const allHandsElem = getElement<HTMLParagraphElement>('all-hands-info', 'p')
  if (playerListElem) {
    // 例: "参加中プレイヤー: プレイヤー1, プレイヤー2, ..."
    const text = playerListElem.textContent || ''
    const match = text.match(/: (.+)/)
    if (match) {
      const names = match[1].split(',').map(s => s.trim())
      // handsのキー順とnamesの順が一致している前提で表示
      const handList = Object.values(hands)
      const display = names.map((name, i) => `${name}: ${handList[i] ?? '?'}枚`).join('　')
      allHandsElem.textContent = `全員の手札: ${display}`
    } else {
      allHandsElem.textContent = ''
    }
  } else {
    allHandsElem.textContent = ''
  }
}

let autoDrawActive = false
let autoDrawTimeout: ReturnType<typeof setTimeout> | null = null
let lastFieldCard: { suit: string, value: number } | null = null

/**
 * 場のカード情報を受信して表示
 * @param card 場のカード情報（nullの場合はカードなし）
 */
function handleFieldCard(card: { suit: string, value: number } | null) {
  console.log('受信: fieldCard', card)
  lastFieldCard = card
  const fieldElem = getElement<HTMLDivElement>('field-card', 'div')
  renderCard(fieldElem, card, onTouchField)
  // 1/3/9以外のときだけ5秒後に自動進行再開
  if (card && card.value !== 1 && card.value !== 3 && card.value !== 9) {
    if (autoDrawTimeout) clearTimeout(autoDrawTimeout)
    autoDrawActive = false // ここで必ず解除
    if (deckRemaining > 0) {
      autoDrawTimeout = setTimeout(() => {
        startAutoDrawSequence()
      }, 2000)
    }
  } else {
    // 「1」「3」「9」のときはtouchResultで再開
    autoDrawActive = false
  }
}

function onTouchField() {
  socket.emit('touchField')
}

function handleTouchResult(result: { loserId: string, field: any[], mistake?: boolean, mistakeFirstId?: string } | null) {
  if (result && result.loserId) {
    // プレイヤー名を取得（なければ「プレイヤーX」）
    const playerListElem = document.getElementById('player-list')
    let loserName = result.loserId
    let mistakeFirstName = result.mistakeFirstId || ''
    if (playerListElem) {
      const text = playerListElem.textContent || ''
      const match = text.match(/: (.+)/)
      if (match) {
        const names = match[1].split(',').map(s => s.trim())
        const getNameById = (id: string) => {
          const idNum = parseInt(id.replace(/\D/g, ''), 10)
          if (!isNaN(idNum) && names[idNum - 1]) return names[idNum - 1]
          return names[0] || id
        }
        loserName = getNameById(result.loserId)
        if (result.mistakeFirstId) {
          mistakeFirstName = getNameById(result.mistakeFirstId)
        }
      }
    }
    if (result.mistake) {
      if (mistakeFirstName) {
        showNotification(`誤タッチ！一番早かったのは ${mistakeFirstName} さんです！`, 'mistake')
      } else {
        showNotification(`誤タッチ！一番早かったのは ${loserName} さんです！`, 'mistake')
      }
    } else {
      showNotification(`一番遅かったのは ${loserName} さんです！`, 'success')
    }
  } else {
    // 誰も手を置かなかった
  }
  // カウント再開タイミング判定
  if (lastFieldCard && (lastFieldCard.value === 1 || lastFieldCard.value === 3 || lastFieldCard.value === 9)) {
    // 1/3/9のときは誰かが手を置いた5秒後
    if (autoDrawTimeout) clearTimeout(autoDrawTimeout)
    autoDrawTimeout = setTimeout(() => {
      if (deckRemaining > 0) {
        autoDrawActive = false
        startAutoDrawSequence()
      }
    }, 3000)
  }
}

// --- カウントダウン表示＆自動カードめくり ---
function startAutoDrawSequence() {
  if (autoDrawActive || deckRemaining <= 0) return
  autoDrawActive = true
  const fieldArea = document.getElementById('field-area')
  if (!fieldArea) return
  let countElem = document.getElementById('countdown-text') as HTMLDivElement
  if (!countElem) {
    countElem = document.createElement('div')
    countElem.id = 'countdown-text'
    countElem.style.fontSize = '2.2rem'
    countElem.style.fontWeight = 'bold'
    countElem.style.marginBottom = '8px'
    countElem.style.height = '2.5em'
    countElem.style.letterSpacing = '0.2em'
    countElem.style.color = '#0070f3'
    fieldArea.insertBefore(countElem, fieldArea.firstChild)
  }
  const texts = ['いっ', 'きゅう', 'さん！']
  let idx = 0
  countElem.textContent = ''
  const interval = setInterval(() => {
    countElem.textContent = texts[idx]
    idx++
    if (idx === texts.length) {
      clearInterval(interval)
      // 1秒間「さん！」を表示してからカードをめくる
      setTimeout(() => {
        // デッキが残っていれば次のカードを引く
        socket.emit('drawCard')
        countElem.textContent = ''
      }, 1000)
    }
  }, 1000)
}

function setupUI() {
  // ゲーム開始ボタン
  const startBtn = getElement<HTMLButtonElement>('start-game-btn', 'button')
  startBtn.textContent = 'ゲーム開始'
  startBtn.addEventListener('click', () => {
    console.log('ゲーム開始ボタンがクリックされました')
    socket.emit('startGame')
  })

  // 参加中プレイヤー欄の初期化
  const playerListElem = getElement<HTMLParagraphElement>('player-list', 'p')
  playerListElem.textContent = '参加中プレイヤー: '

  // 全員の手札欄の初期化
  const allHandsElem = getElement<HTMLParagraphElement>('all-hands-info', 'p')
  allHandsElem.textContent = ''
}

setupUI()

// Socket.IOイベントハンドラ登録
socket.on('playerInfo', handlePlayerInfo)
socket.on('playerList', handlePlayerList)
socket.on('deckInfo', handleDeckInfo)
socket.on('handInfo', handleHandInfo)
socket.on('fieldCard', handleFieldCard)
socket.on('touchResult', handleTouchResult)
