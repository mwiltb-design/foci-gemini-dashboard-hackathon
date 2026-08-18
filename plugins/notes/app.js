const pluginId = 'notes'
const pending = new Map()
const status = document.getElementById('status')
const list = document.getElementById('notes')
const form = document.getElementById('note-form')
const input = document.getElementById('note-text')
const addButton = document.getElementById('add-button')

function runtime(method, path, body) {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('Plugin request timed out'))
    }, 12000)
    pending.set(requestId, { resolve, reject, timer })
    parent.postMessage({
      schemaVersion: 1,
      pluginId,
      type: 'runtime-request',
      requestId,
      method,
      path,
      ...(body === undefined ? {} : { body }),
    }, '*')
  })
}

window.addEventListener('message', (event) => {
  if (event.source !== parent) return
  const message = event.data
  if (message && message.schemaVersion === 1 && message.pluginId === pluginId && message.type === 'host-ready') {
    void refresh()
    return
  }
  if (!message || message.schemaVersion !== 1 || message.pluginId !== pluginId || message.type !== 'runtime-response') return
  const request = pending.get(message.requestId)
  if (!request) return
  clearTimeout(request.timer)
  pending.delete(message.requestId)
  if (message.status >= 200 && message.status < 300) request.resolve(message.body)
  else request.reject(new Error(message.body && message.body.error ? message.body.error : `Request failed (${message.status})`))
})

function render(notes) {
  list.replaceChildren()
  list.hidden = notes.length === 0
  status.hidden = notes.length > 0
  status.className = 'empty'
  status.textContent = 'No notes yet. Add one here or ask Pi after granting access.'
  for (const note of notes) {
    const item = document.createElement('li')
    const content = document.createElement('div')
    const text = document.createElement('p')
    const created = document.createElement('time')
    const remove = document.createElement('button')
    text.textContent = note.text
    created.dateTime = note.createdAt
    created.textContent = new Date(note.createdAt).toLocaleString()
    remove.type = 'button'
    remove.textContent = 'Delete'
    remove.addEventListener('click', async () => {
      remove.disabled = true
      try {
        await runtime('DELETE', '/notes', { id: note.id })
        await refresh()
      } catch (error) {
        showError(error)
      }
    })
    content.append(text, created)
    item.append(content, remove)
    list.append(item)
  }
}

function showError(error) {
  status.hidden = false
  status.className = 'error'
  status.textContent = error instanceof Error ? error.message : 'Shared Notes is unavailable'
}

async function refresh() {
  try {
    const result = await runtime('GET', '/notes')
    render(result.notes || [])
  } catch (error) {
    showError(error)
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const text = input.value.trim()
  if (!text) return
  addButton.disabled = true
  try {
    await runtime('POST', '/notes', { text })
    input.value = ''
    await refresh()
  } catch (error) {
    showError(error)
  } finally {
    addButton.disabled = false
  }
})

parent.postMessage({ schemaVersion: 1, pluginId, type: 'ready' }, '*')
setTimeout(() => void refresh(), 250)
