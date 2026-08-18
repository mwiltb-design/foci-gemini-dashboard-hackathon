import { FormEvent, useState } from 'react'
import type { ExtensionUiRequest } from '../hooks/usePiChat'

interface ExtensionDialogProps {
  request: ExtensionUiRequest
  onRespond: (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void
}

export function ExtensionDialog({ request, onRespond }: ExtensionDialogProps) {
  const [value, setValue] = useState(request.prefill ?? '')

  function submit(event: FormEvent) {
    event.preventDefault()
    onRespond({ value })
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <span className="eyebrow">Pi needs your input</span>
        <h2 id="dialog-title">{request.title ?? 'Continue?'}</h2>
        {request.message && <p>{request.message}</p>}

        {request.method === 'confirm' && (
          <div className="dialog__actions">
            <button className="button button--quiet" type="button" onClick={() => onRespond({ confirmed: false })}>No</button>
            <button className="button button--primary" type="button" autoFocus onClick={() => onRespond({ confirmed: true })}>Yes</button>
          </div>
        )}

        {request.method === 'select' && (
          <div className="dialog__options">
            {request.options?.map((option) => <button className="button" type="button" key={option} onClick={() => onRespond({ value: option })}>{option}</button>)}
            <button className="button button--quiet" type="button" onClick={() => onRespond({ cancelled: true })}>Cancel</button>
          </div>
        )}

        {(request.method === 'input' || request.method === 'editor') && (
          <form onSubmit={submit}>
            {request.method === 'editor'
              ? <textarea value={value} onChange={(event) => setValue(event.target.value)} autoFocus rows={8} />
              : <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} autoFocus />}
            <div className="dialog__actions">
              <button className="button button--quiet" type="button" onClick={() => onRespond({ cancelled: true })}>Cancel</button>
              <button className="button button--primary" type="submit">Submit</button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
