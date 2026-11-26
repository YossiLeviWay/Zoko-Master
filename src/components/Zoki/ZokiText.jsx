import { zokiBlocks, zokiInline } from '../../utils/zokiDisplayText.js';

function Inline({ text }) {
  return zokiInline(text).map((part, index) => (part.strong
    ? <strong key={index}>{part.strong}</strong>
    : <span key={index}>{part.text}</span>));
}

export default function ZokiText({ text, sources }) {
  const blocks = zokiBlocks(text, sources);
  if (!blocks.length) return null;
  return <div className="zoki-rich">
    {blocks.map((block, index) => (block.type === 'list'
      ? <ul key={index}>{block.items.map(item => <li key={item}><Inline text={item} /></li>)}</ul>
      : <p key={index}><Inline text={block.text} /></p>))}
  </div>;
}
