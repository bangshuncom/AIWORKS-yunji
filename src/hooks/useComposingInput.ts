// 受控输入框在 onChange 里改写内容（过滤非法字符、逗号归一化等）时的输入法保护。
//
// 组词（composition）期间改写受控值会打乱 IME 缓冲区：DOM 值被 React 改掉后
// 输入法认为内容被外部修改，提交时会把同一个字符再追加一次。
// 典型表现就是「输入一个中文逗号，冒出两个逗号」。
//
// 用法：
//   const composing = useComposingInput();
//   <Input
//     value={x}
//     onChange={(_, d) => setX(composing.transform(d.value, normalize))}
//     onCompositionStart={composing.onCompositionStart}
//     onCompositionEnd={(ev) => {
//       composing.onCompositionEnd();
//       // compositionend 与最终一次 input 事件的先后顺序各浏览器不一致，这里再兜一次
//       setX(normalize(ev.currentTarget.value));
//     }}
//   />
import { useRef } from 'react';

export function useComposingInput() {
  const composingRef = useRef(false);

  return {
    /** 组词期间原样放行，其余时候套用 transform */
    transform: (value: string, transform: (s: string) => string) => (composingRef.current ? value : transform(value)),
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
    },
  };
}
