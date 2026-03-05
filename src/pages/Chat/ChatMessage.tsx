/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { User, Copy, Check, ChevronDown, ChevronRight, Wrench, FileText, Film, Music, FileArchive, File, X, FolderOpen, ZoomIn, Loader2, CheckCircle2, AlertCircle, ExternalLink, FileSpreadsheet, FileCode, FileImage } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { extractText, extractThinking, extractImages, extractToolUse, formatTimestamp } from './message-utils';
import logoSvg from '@/assets/logo.svg';

interface ChatMessageProps {
  message: RawMessage;
  showThinking: boolean;
  isStreaming?: boolean;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}

interface ExtractedImage { url?: string; data?: string; mimeType: string; }

/** Resolve an ExtractedImage to a displayable src string, or null if not possible. */
function imageSrc(img: ExtractedImage): string | null {
  if (img.url) return img.url;
  if (img.data) return `data:${img.mimeType};base64,${img.data}`;
  return null;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  showThinking,
  isStreaming = false,
  streamingTools = [],
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const text = extractText(message);
  const hasText = text.trim().length > 0;
  const thinking = extractThinking(message);
  const images = extractImages(message);
  const tools = extractToolUse(message);
  const visibleThinking = showThinking ? thinking : null;
  const visibleTools = tools;

  const attachedFiles = message._attachedFiles || [];
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);

  // Never render tool result messages in chat UI
  if (isToolResult) return null;

  const hasStreamingToolStatus = isStreaming && streamingTools.length > 0;
  if (!hasText && !visibleThinking && images.length === 0 && visibleTools.length === 0 && attachedFiles.length === 0 && !hasStreamingToolStatus) return null;

  return (
    <div
      className={cn(
        'flex gap-3 group',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1',
          isUser && 'bg-primary text-primary-foreground',
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <img src={logoSvg} alt="" className="h-8 w-8 object-contain p-1 border border-gray-200 rounded-full" />}
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex flex-col w-full min-w-0 max-w-[80%] space-y-2',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {isStreaming && !isUser && streamingTools.length > 0 && (
          <ToolStatusBar tools={streamingTools} />
        )}

        {/* Thinking section */}
        {visibleThinking && (
          <ThinkingBlock content={visibleThinking} />
        )}

        {/* Tool use cards */}
        {visibleTools.length > 0 && (
          <div className="space-y-1">
            {visibleTools.map((tool, i) => (
              <ToolCard key={tool.id || i} name={tool.name} input={tool.input} />
            ))}
          </div>
        )}

        {/* Images — rendered ABOVE text bubble for user messages */}
        {/* Images from content blocks (Gateway session data / channel push photos) */}
        {isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImageThumbnail
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — images above text for user, file cards below */}
        {isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              // Skip image attachments if we already have images from content blocks
              if (isImage && images.length > 0) return null;
              if (isImage) {
                return file.preview ? (
                  <ImageThumbnail
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                ) : (
                  <div
                    key={`local-${i}`}
                    className="w-36 h-36 rounded-xl border overflow-hidden bg-muted flex items-center justify-center text-muted-foreground"
                  >
                    <File className="h-8 w-8" />
                  </div>
                );
              }
              // Non-image files → file card
              return <FileCard key={`local-${i}`} file={file} />;
            })}
          </div>
        )}

        {/* Main text bubble */}
        {hasText && (
          <MessageBubble
            text={text}
            isUser={isUser}
            isStreaming={isStreaming}
          />
        )}

        {/* Images from content blocks — assistant messages (below text) */}
        {!isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImagePreviewCard
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — assistant messages (below text) */}
        {!isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              if (isImage && images.length > 0) return null;
              if (isImage && file.preview) {
                return (
                  <ImagePreviewCard
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                );
              }
              if (isImage && !file.preview) {
                return (
                  <div key={`local-${i}`} className="w-36 h-36 rounded-xl border overflow-hidden bg-muted flex items-center justify-center text-muted-foreground">
                    <File className="h-8 w-8" />
                  </div>
                );
              }
              return <FileCard key={`local-${i}`} file={file} />;
            })}
          </div>
        )}

        {/* Hover row for user messages — timestamp only */}
        {isUser && message.timestamp && (
          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none">
            {formatTimestamp(message.timestamp)}
          </span>
        )}

        {/* Hover row for assistant messages — only when there is real text content */}
        {!isUser && hasText && (
          <AssistantHoverBar text={text} timestamp={message.timestamp} />
        )}
      </div>

      {/* Image lightbox portal */}
      {lightboxImg && (
        <ImageLightbox
          src={lightboxImg.src}
          fileName={lightboxImg.fileName}
          filePath={lightboxImg.filePath}
          base64={lightboxImg.base64}
          mimeType={lightboxImg.mimeType}
          onClose={() => setLightboxImg(null)}
        />
      )}
    </div>
  );
});

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function ToolStatusBar({
  tools,
}: {
  tools: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}) {
  return (
    <div className="w-full space-y-1">
      {tools.map((tool) => {
        const duration = formatDuration(tool.durationMs);
        const isRunning = tool.status === 'running';
        const isError = tool.status === 'error';
        return (
          <div
            key={tool.toolCallId || tool.id || tool.name}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors',
              isRunning && 'border-primary/30 bg-primary/5 text-foreground',
              !isRunning && !isError && 'border-border/50 bg-muted/20 text-muted-foreground',
              isError && 'border-destructive/30 bg-destructive/5 text-destructive',
            )}
          >
            {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
            {!isRunning && !isError && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
            {isError && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
            <Wrench className="h-3 w-3 shrink-0 opacity-60" />
            <span className="font-mono text-[12px] font-medium">{tool.name}</span>
            {duration && <span className="text-[11px] opacity-60">{duration}</span>}
            {tool.summary && (
              <span className="truncate text-[11px] opacity-70">{tool.summary}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Assistant hover bar (timestamp + copy, shown on group hover) ─

function AssistantHoverBar({ text, timestamp }: { text: string; timestamp?: number }) {
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <div className="flex items-center justify-between w-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none px-1">
      <span className="text-xs text-muted-foreground">
        {timestamp ? formatTimestamp(timestamp) : ''}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={copyContent}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

// ── Typewriter Hook ─────────────────────────────────────────────
// 在 streamingMessage 跳跃更新与实际字符显示之间插入缓冲层。
// 每帧追加 CHARS_PER_FRAME 个字符，isStreaming=false 时立即跳到全文。

function useTypewriter(targetText: string, isStreaming: boolean): string {
  const [displayed, setDisplayed] = useState(targetText);
  const targetRef = useRef(targetText);
  const rafRef = useRef<number>(0);

  // 同步 ref 到最新目标（避免 tick 闭包中读到旧值）
  useEffect(() => {
    targetRef.current = targetText;
  }, [targetText]);

  useEffect(() => {
    if (!isStreaming) {
      // 流式结束：取消动画，立即显示完整文本
      cancelAnimationFrame(rafRef.current);
      setDisplayed(targetText);
      return;
    }

    const CHARS_PER_FRAME = 6; // ~360 字符/秒 @60fps，可调节

    const tick = () => {
      setDisplayed(prev => {
        const target = targetRef.current;
        if (prev.length >= target.length) return target;
        return target.slice(0, prev.length + CHARS_PER_FRAME);
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isStreaming]); // targetText 变化由 ref 处理，不重启 effect

  return displayed;
}

// ── Message Bubble ──────────────────────────────────────────────

function MessageBubble({
  text,
  isUser,
  isStreaming,
}: {
  text: string;
  isUser: boolean;
  isStreaming: boolean;
}) {
  const displayedText = useTypewriter(text, isStreaming);

  return (
    <div
      className={cn(
        'relative rounded-2xl px-4 py-3',
        !isUser && 'w-full',
        isUser
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted',
      )}
    >
      {isUser ? (
        <p className="whitespace-pre-wrap break-words break-all text-sm">{text}</p>
      ) : isStreaming ? (
        // 流式阶段：纯文本渲染 + typewriter 光标，跳过 ReactMarkdown 的 AST 解析开销
        <div className="prose prose-sm dark:prose-invert max-w-none break-words break-all">
          <p className="whitespace-pre-wrap break-words break-all text-sm leading-relaxed m-0">
            {displayedText}
            <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5 align-text-bottom" />
          </p>
        </div>
      ) : (
        // 完成阶段：完整 markdown 渲染
        <div className="prose prose-sm dark:prose-invert max-w-none break-words break-all">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !className;
                if (isInline) {
                  const text = typeof children === 'string' ? children : String(children ?? '');
                  if (isFilePath(text)) {
                    return <FilePathInlineCode path={text} />;
                  }
                  return (
                    <code className="bg-background/50 px-1.5 py-0.5 rounded text-sm font-mono break-words break-all" {...props}>
                      {children}
                    </code>
                  );
                }
                return (
                  <pre className="bg-background/50 rounded-lg p-4 overflow-x-auto">
                    <code className={cn('text-sm font-mono', className)} {...props}>
                      {children}
                    </code>
                  </pre>
                );
              },
              a({ href, children }) {
                // File-path links (e.g. file:// or bare absolute paths used as hrefs)
                if (href && isFilePath(href)) {
                  return <FilePathInlineCode path={href} />;
                }
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-words break-all">
                    {children}
                  </a>
                );
              },
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      )}

    </div>
  );
}

// ── Thinking Block ──────────────────────────────────────────────

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full rounded-lg border border-border/50 bg-muted/30 text-sm">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="font-medium">Thinking</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-muted-foreground">
          <div className="prose prose-sm dark:prose-invert max-w-none opacity-75">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ── File Path Detection & Inline Component ──────────────────────

/** Returns true if the string looks like a local filesystem path. */
function isFilePath(text: string): boolean {
  const s = text.trim();
  if (s.length < 2 || s.includes('\n')) return false;
  // Unix absolute: /foo/bar or ~/foo
  if (/^(\/|~\/)/.test(s)) return true;
  // Windows absolute: C:\ or C:/
  if (/^[A-Za-z]:[/\\]/.test(s)) return true;
  // Relative paths with an explicit dot prefix: ./foo or ../foo
  if (/^\.\.?[/\\]/.test(s)) return true;
  return false;
}

/**
 * Renders an inline code span that looks like a file path.
 * - Click on the text → open with the default application.
 * - Hover → show a small "show in folder" icon button.
 */
function FilePathInlineCode({ path }: { path: string }) {
  const [hovered, setHovered] = useState(false);

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.electron.ipcRenderer.invoke('shell:openPath', path);
  }, [path]);

  const handleShowInFolder = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.electron.ipcRenderer.invoke('shell:showItemInFolder', path);
  }, [path]);

  return (
    <span
      className="inline-flex items-center gap-0.5 align-baseline"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <code
        className="bg-background/50 px-1.5 py-0.5 rounded text-sm font-mono break-all cursor-pointer hover:bg-primary/15 hover:text-primary transition-colors"
        onClick={handleOpen}
        title="点击打开文件"
      >
        {path}
      </code>
      <span
        className={cn(
          'inline-flex items-center gap-0.5 transition-opacity duration-150',
          hovered ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      >
        <button
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          onClick={handleOpen}
          title="用默认程序打开文件"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          onClick={handleShowInFolder}
          title="在文件夹中显示"
        >
          <FolderOpen className="h-3 w-3" />
        </button>
      </span>
    </span>
  );
}

// ── File Card (for user-uploaded non-image files) ───────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('image/')) return <FileImage className={className} />;
  // Spreadsheets: xlsx, xls, csv
  if (
    mimeType === 'text/csv' ||
    mimeType.includes('spreadsheet') ||
    mimeType === 'application/vnd.ms-excel'
  ) return <FileSpreadsheet className={className} />;
  // Code / structured text: json, xml, html, code files
  if (
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'text/html' ||
    mimeType === 'text/css' ||
    mimeType === 'text/javascript' ||
    mimeType === 'application/javascript'
  ) return <FileCode className={className} />;
  // Plain text, markdown, PDF, Word, Presentation → document icon
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/pdf' ||
    mimeType.includes('wordprocessingml') ||
    mimeType === 'application/msword' ||
    mimeType.includes('presentationml') ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    mimeType === 'application/rtf' ||
    mimeType === 'application/epub+zip'
  ) return <FileText className={className} />;
  // Archives
  if (
    mimeType.includes('zip') ||
    mimeType.includes('compressed') ||
    mimeType.includes('archive') ||
    mimeType.includes('tar') ||
    mimeType.includes('rar') ||
    mimeType.includes('7z')
  ) return <FileArchive className={className} />;
  return <File className={className} />;
}

function FileCard({ file }: { file: AttachedFileMeta }) {
  const hasPath = Boolean(file.filePath);

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (file.filePath) {
      window.electron.ipcRenderer.invoke('shell:openPath', file.filePath);
    }
  }, [file.filePath]);

  const handleShowInFolder = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (file.filePath) {
      window.electron.ipcRenderer.invoke('shell:showItemInFolder', file.filePath);
    }
  }, [file.filePath]);

  return (
    <div
      className={cn(
        'group/fc flex items-center gap-2 rounded-lg border border-border px-3 py-2 bg-muted/30 max-w-[260px] transition-colors',
        hasPath && 'cursor-pointer hover:bg-muted/60 hover:border-border/80',
      )}
      onClick={hasPath ? handleOpen : undefined}
      title={hasPath ? '点击打开文件' : undefined}
    >
      <FileIcon mimeType={file.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="text-xs font-medium truncate">{file.fileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {file.fileSize > 0 ? formatFileSize(file.fileSize) : 'File'}
        </p>
      </div>
      {hasPath && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover/fc:opacity-100 transition-opacity shrink-0">
          <button
            className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleOpen}
            title="用默认程序打开"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
          <button
            className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleShowInFolder}
            title="在文件夹中显示"
          >
            <FolderOpen className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Image Thumbnail (user bubble — square crop with zoom hint) ──

function ImageThumbnail({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className="relative w-36 h-36 rounded-xl border overflow-hidden bg-muted group/img cursor-zoom-in"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Preview Card (assistant bubble — natural size with overlay actions) ──

function ImagePreviewCard({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className="relative max-w-xs rounded-lg border overflow-hidden group/img cursor-zoom-in"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="block w-full" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Lightbox ───────────────────────────────────────────────

function ImageLightbox({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onClose,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onClose: () => void;
}) {
  void src; void base64; void mimeType; void fileName;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleShowInFolder = useCallback(() => {
    if (filePath) {
      window.electron.ipcRenderer.invoke('shell:showItemInFolder', filePath);
    }
  }, [filePath]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Image + buttons stacked */}
      <div
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={fileName}
          className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl object-contain"
        />

        {/* Action buttons below image */}
        <div className="flex items-center gap-2">
          {filePath && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
              onClick={handleShowInFolder}
              title="在文件夹中显示"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={onClose}
            title="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Tool Card ───────────────────────────────────────────────────

function ToolCard({ name, input }: { name: string; input: unknown }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 text-sm">
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
        <Wrench className="h-3 w-3 shrink-0 opacity-60" />
        <span className="font-mono text-xs">{name}</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && input != null && (
        <pre className="px-3 pb-2 text-xs text-muted-foreground overflow-x-auto">
          {typeof input === 'string' ? input : JSON.stringify(input, null, 2) as string}
        </pre>
      )}
    </div>
  );
}
