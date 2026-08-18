import CodeMirror from '@uiw/react-codemirror'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { yaml } from '@codemirror/lang-yaml'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

function languageExtensions(language: string) {
  switch (language) {
    case 'typescript': return [javascript({ typescript: true })]
    case 'tsx': return [javascript({ typescript: true, jsx: true })]
    case 'javascript': return [javascript()]
    case 'jsx': return [javascript({ jsx: true })]
    case 'json': return [json()]
    case 'css': return [css()]
    case 'html': return [html()]
    case 'markdown': return [markdown()]
    case 'yaml': return [yaml()]
    case 'python': return [python()]
    default: return []
  }
}

export function SourceEditor({ content, language, editable, onChange }: {
  content: string
  language: string
  editable: boolean
  onChange?: (value: string) => void
}) {
  return (
    <CodeMirror
      className="source-editor"
      value={content}
      height="100%"
      minHeight="520px"
      maxHeight="650px"
      theme="dark"
      extensions={languageExtensions(language)}
      editable={editable}
      readOnly={!editable}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: editable,
        highlightActiveLineGutter: editable,
        foldGutter: true,
        autocompletion: editable,
      }}
      onChange={onChange}
    />
  )
}

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <article className="file-markdown markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
    </article>
  )
}
