// 翻译设置（仅管理员）：服务商模板 + 按引擎渲染的字段 + 连通性测试
//
// 翻译引擎分两类（见后端 `translate/engine.rs`）：
//   · 大模型（OpenAI 兼容）：要接口地址、模型名、一个 API Key；
//   · 机器翻译（DeepL / LibreTranslate / MyMemory / 百度 / 腾讯云）：没有模型名，
//     域名由厂商固定，百度与腾讯要**两个**凭证，腾讯还要地域。
// 所以这里不写死字段，而是**照后端下发的规格渲染**：以后加引擎，这个文件不用改。
//
// 所有密钥类字段**按服务商分别保存**（`translate_<item>_<provider>`）：
// 切换服务商各自恢复自己的值，互不覆盖、也不用重新输入。
// 后端只回传「是否已配置 + 末 4 位」，这里永远不回填明文——留空即表示"不修改"。
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Combobox,
  Dropdown,
  Input,
  Label,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import { TranslateRegular } from '@fluentui/react-icons';
import { translateApi, settingsApi } from '../../lib/tauri';
import { useStyles } from './styles';

export function TranslateTab() {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: cfg, isLoading } = useQuery({
    queryKey: ['translate-config'],
    queryFn: translateApi.config,
  });
  const { data: options } = useQuery({
    queryKey: ['translate-options'],
    queryFn: translateApi.options,
  });

  const [provider, setProvider] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  /** 第一个凭证：API Key / APP ID / SecretId / 邮箱 */
  const [cred1, setCred1] = useState('');
  /** 第二个凭证：百度的密钥 / 腾讯的 SecretKey；其余引擎用不到 */
  const [cred2, setCred2] = useState('');
  /** 附加参数：腾讯的地域；其余引擎用不到 */
  const [extra, setExtra] = useState('');
  const [targetLang, setTargetLang] = useState('zh');
  const [batchChars, setBatchChars] = useState(2000);
  const [loaded, setLoaded] = useState(false);
  /** 从服务商拉到的模型列表；null = 还没拉过。属于"当前服务商"，切换时清空 */
  const [models, setModels] = useState<string[] | null>(null);

  useEffect(() => {
    if (cfg && !loaded) {
      setProvider(cfg.provider || cfg.providers[0]?.id || 'zhipu');
      setBaseUrl(cfg.base_url);
      setModel(cfg.model);
      setExtra(cfg.extra);
      setTargetLang(cfg.target_lang);
      setBatchChars(cfg.batch_chars);
      setLoaded(true);
    }
  }, [cfg, loaded]);

  /** 输入框允许中间态乱填，保存时统一收进后端认可的范围，免得一保存就报错 */
  const clampBatchChars = (n: number): number => {
    const lo = cfg?.batch_chars_min ?? 200;
    const hi = cfg?.batch_chars_max ?? 20000;
    const def = cfg?.batch_chars_default ?? 2000;
    if (!Number.isFinite(n) || n <= 0) return def;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  };

  /**
   * 服务商维度的设置键名。拼法必须与后端 `translate::provider_setting` 一致
   * （空服务商归入 default 桶），否则保存和读取会落到不同的桶。
   */
  const providerSettingName = (item: string, id: string): string => `translate_${item}_${id.trim() || 'default'}`;

  /**
   * 提交给后端的设置。接口地址 / 模型名 / 两个凭证 / 附加参数都只写
   * 「当前服务商」自己的桶；密钥留空时不带该键 = 保持原有值不变。
   */
  const buildPayload = (): Record<string, string> => {
    const p: Record<string, string> = {
      translate_provider: provider,
      translate_target_lang: targetLang,
      translate_batch_chars: String(clampBatchChars(batchChars)),
      [providerSettingName('base_url', provider)]: baseUrl.trim(),
      [providerSettingName('model', provider)]: model.trim(),
      [providerSettingName('extra', provider)]: extra.trim(),
    };
    // 只写「当前服务商」那一个桶，别的服务商的密钥原样留着
    if (cred1.trim()) p[providerSettingName('api_key', provider)] = cred1.trim();
    if (cred2.trim()) p[providerSettingName('api_key2', provider)] = cred2.trim();
    return p;
  };

  const afterSave = () => {
    setCred1('');
    setCred2('');
    setLoaded(false); // 让 config 重新回填（尾号会更新）
    queryClient.invalidateQueries({ queryKey: ['translate-config'] });
    queryClient.invalidateQueries({ queryKey: ['translate-options'] });
  };

  const saveMut = useMutation({
    mutationFn: () => settingsApi.update(buildPayload()),
    onSuccess: () => {
      afterSave();
      setMsg({ ok: true, text: '翻译设置已保存' });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '保存失败' }),
  });

  // 测试前必须先落库：后端只按已保存的配置发起请求，
  // 这样「接口地址 / 模型 / 密钥」永远不会由前端在调用时指定。
  const testMut = useMutation({
    mutationFn: async () => {
      await settingsApi.update(buildPayload());
      return translateApi.test();
    },
    onSuccess: (text) => {
      afterSave();
      setMsg({ ok: true, text: `连接成功，示范译文：${text}` });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '连接失败' }),
  });

  // 拉取模型列表同样先落库：后端按「已保存」的地址与 Key 去请求 /models，
  // 前端只指定服务商，不能借这条命令打任意地址。
  const fetchModelsMut = useMutation({
    mutationFn: async () => {
      await settingsApi.update(buildPayload());
      return translateApi.fetchModels(provider);
    },
    onSuccess: (list) => {
      afterSave();
      setModels(list);
      if (list.length === 0) {
        setMsg({ ok: false, text: '服务商没有返回任何模型，请手动填写模型名' });
      } else {
        setMsg({ ok: true, text: `已获取 ${list.length} 个模型，在「模型名」下拉中选择即可` });
      }
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '获取模型列表失败' }),
  });
  // 机翻引擎没有「模型列表」这回事，点它只会拿到一句明确的拒绝

  const busy = saveMut.isPending || testMut.isPending || fetchModelsMut.isPending;

  const onProviderChange = (id: string) => {
    setProvider(id);
    // 输入框里可能还留着上一个服务商的密钥草稿，切走就清掉，
    // 免得它被当成新服务商的密钥写进另一个桶。
    setCred1('');
    setCred2('');
    // 模型列表属于"拉取时的那个服务商"，切走就作废
    setModels(null);
    const p = cfg?.providers.find((x) => x.id === id);
    // 优先恢复该服务商自己保存过的值；没存过才回落到模板默认值。
    // 「自定义」没有模板值，只恢复存过的部分。
    const savedBase = cfg?.saved_base_urls?.[id];
    const savedModel = cfg?.saved_models?.[id];
    const savedExtra = cfg?.saved_extras?.[id];
    if (p?.base_url) {
      setBaseUrl(savedBase || p.base_url);
      setModel(savedModel || p.default_model);
    } else {
      if (savedBase) setBaseUrl(savedBase);
      if (savedModel) setModel(savedModel);
    }
    // 附加参数（腾讯的地域）：没存过就用模板默认，避免留空
    setExtra(savedExtra || p?.extra_default || '');
  };

  // 等语言列表也到位再渲染：Dropdown 的显示文本靠 Option 反查，
  // 列表为空时首帧必然显示不出当前值（见下方 value 注释）。
  if (isLoading || !loaded || !options) return <Spinner label="加载中..." />;

  const providers = cfg?.providers ?? [];
  const current = providers.find((p) => p.id === provider);
  const langs = options.languages;
  const currentLang = langs.find((l) => l.code === targetLang);
  const usesModel = current?.uses_model ?? true;
  const baseUrlEditable = current?.base_url_editable ?? true;
  /** 当前服务商是否已经存过这个凭证：与「已保存的服务商」比对，存过就提示不必重填 */
  const savedHint = (savedIds: string[] | undefined, tail?: string): string | null => {
    if (!(savedIds ?? []).includes(provider)) return null;
    return provider === cfg?.provider && tail
      ? `已保存（尾号 ${tail}），留空则不修改`
      : `${current?.name ?? '该服务商'}已保存过，留空则沿用`;
  };
  const hint1 = savedHint(cfg?.providers_with_key, cfg?.api_key_tail);
  const hint2 = savedHint(cfg?.providers_with_key2, cfg?.api_key2_tail);
  const savedKeyCount = (cfg?.providers_with_key ?? []).length;

  return (
    <Card className={styles.card}>
      <div className={styles.title}>
        <TranslateRegular /> 翻译设置
      </div>
      <p style={{ marginTop: 0, fontSize: '13px', color: tokens.colorNeutralForeground2 }}>
        编辑页的「翻译」按钮通过这里配置的引擎工作。所有登录用户共用这一份配置， 因此密钥<b>每个服务商只需填一次</b>
        ，且各项设置都按服务商各存各的，
        <b>切换服务商既不会覆盖、也不用重新输入</b>。文本会发送到所选服务商， 请留意内容是否适合外发。
      </p>

      <div className={styles.field}>
        <Label htmlFor="tr_provider">服务商</Label>
        {/*
          value 必须受控传入：Fluent 的 Dropdown 在不传 value 时，显示文本是从
          「已注册的 Option」里反查的，而首帧 Option 还没注册，于是显示为空白；
          只有用户手动选中一次（selectedOptions 变化）才会显示出来。
          这里显式给 value，未交互时也能看到当前配置。
        */}
        <Dropdown
          id="tr_provider"
          value={current ? `${current.name} · ${current.kind_label}` : provider}
          selectedOptions={[provider]}
          onOptionSelect={(_, d) => onProviderChange(d.optionValue ?? '')}
          placeholder="请选择服务商"
          style={{ minWidth: '280px', maxWidth: '420px' }}
          listbox={{ style: { minWidth: '280px' } }}
        >
          {providers.map((p) => (
            <Option key={p.id} value={p.id} text={`${p.name} · ${p.kind_label}`}>
              {`${p.name} · ${p.kind_label}`}
            </Option>
          ))}
        </Dropdown>
        {current?.note && (
          <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>{current.note}</span>
        )}
      </div>

      {/* 机翻的域名由厂商固定，不露输入框：给它一个空框只会让人以为填错了要改 */}
      {baseUrlEditable ? (
        <div className={styles.field}>
          <Label htmlFor="tr_base_url">接口地址（Base URL）</Label>
          <Input
            id="tr_base_url"
            value={baseUrl}
            onChange={(_, d) => setBaseUrl(d.value)}
            placeholder="https://open.bigmodel.cn/api/paas/v4"
            style={{ maxWidth: '480px' }}
          />
          <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
            {usesModel
              ? '需兼容 OpenAI 的 /chat/completions 协议；地址或模型名以服务商控制台为准'
              : '自建实例填自己的地址；官方托管版保持默认即可'}
          </span>
        </div>
      ) : (
        <div className={styles.field}>
          <Label>接口地址</Label>
          <span style={{ fontSize: '13px', color: tokens.colorNeutralForeground2 }}>
            {baseUrl || current?.base_url}（厂商固定，无需填写）
          </span>
        </div>
      )}

      {usesModel && (
        <div className={styles.field}>
          <Label htmlFor="tr_model">模型名</Label>
          {/*
            Combobox + freeform：拉到模型列表时下拉选择，没拉到时照常手打。
            value 必须受控（同上面 Dropdown 的坑）；freeform 下输入走 onChange、
            选中项走 onOptionSelect，两处都要更新 model。
          */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Combobox
              id="tr_model"
              freeform
              value={model}
              placeholder="glm-4-flash"
              onOptionSelect={(_, d) => {
                const v = d.optionValue ?? d.optionText;
                if (v) setModel(v);
              }}
              onChange={(e) => setModel(e.target.value)}
              style={{ minWidth: '260px', maxWidth: '420px' }}
            >
              {(models ?? []).map((m) => (
                <Option key={m} value={m} text={m}>
                  {m}
                </Option>
              ))}
            </Combobox>
            <Button
              size="small"
              appearance="subtle"
              disabled={busy || !provider || (!cred1.trim() && !hint1)}
              title={!cred1.trim() && !hint1 ? '拉取模型列表需要该服务商的 API Key 鉴权，请先在下方填写' : undefined}
              onClick={() => fetchModelsMut.mutate()}
            >
              {fetchModelsMut.isPending ? '获取中…' : '获取模型列表'}
            </Button>
          </div>
          <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
            可手填；点「获取模型列表」会先保存当前设置，再从该服务商拉取可选模型。 列表接口同样需要该服务商的 API Key
            鉴权，各服务商各用各的 Key。 厂商会下线旧模型：若翻译报 400 / 404，回到这里重新拉取或手动改名即可。
          </span>
        </div>
      )}

      {/* 凭证字段完全照后端的规格渲染：标签、占位符、说明都由引擎决定 */}
      <div className={styles.field}>
        <Label htmlFor="tr_key">{current?.cred1.label ?? 'API Key'}</Label>
        <Input
          id="tr_key"
          type={current?.kind === 'my_memory' ? 'text' : 'password'}
          value={cred1}
          onChange={(_, d) => setCred1(d.value)}
          placeholder={hint1 ?? current?.cred1.placeholder ?? '粘贴服务商控制台生成的密钥'}
          style={{ maxWidth: '480px' }}
        />
        <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
          {current?.cred1.hint}
          {savedKeyCount > 0 && `；各服务商的密钥分别保存（已保存 ${savedKeyCount} 个）`}
        </span>
      </div>

      {current?.cred2 && (
        <div className={styles.field}>
          <Label htmlFor="tr_key2">{current.cred2.label}</Label>
          <Input
            id="tr_key2"
            type="password"
            value={cred2}
            onChange={(_, d) => setCred2(d.value)}
            placeholder={hint2 ?? current.cred2.placeholder}
            style={{ maxWidth: '480px' }}
          />
          <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
            {current.cred2.hint}；与上面一项是一对，两个都要填
          </span>
        </div>
      )}

      {current?.extra && (
        <div className={styles.field}>
          <Label htmlFor="tr_extra">{current.extra.label}</Label>
          <Input
            id="tr_extra"
            value={extra}
            onChange={(_, d) => setExtra(d.value)}
            placeholder={current.extra.placeholder}
            style={{ maxWidth: '240px' }}
          />
          <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>{current.extra.hint}</span>
        </div>
      )}

      {/* 批大小是大模型特有的旋钮：机翻的单次上限由厂商规定，我们自动按上限切批，不用用户操心 */}
      {usesModel && (
        <div className={styles.field}>
          <Label htmlFor="tr_batch">每批最大字数</Label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Input
              id="tr_batch"
              type="number"
              value={String(batchChars)}
              onChange={(_, d) => setBatchChars(Number(d.value))}
              min={cfg?.batch_chars_min}
              max={cfg?.batch_chars_max}
              style={{ width: '130px' }}
              contentAfter={<span style={{ fontSize: '12px' }}>字</span>}
            />
            <Button size="small" appearance="subtle" onClick={() => setBatchChars(cfg?.batch_chars_default ?? 2000)}>
              恢复默认（{cfg?.batch_chars_default ?? 2000}）
            </Button>
          </div>
          {/*
            这段说明不是装饰：批大小的上限完全取决于用户手上的模型，
            写清楚「按什么算、算出来填多少」，管理员才不用反复试。
          */}
          <div
            style={{
              marginTop: '6px',
              padding: '8px 10px',
              borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
              backgroundColor: tokens.colorNeutralBackground3,
              borderRadius: '4px',
              fontSize: '12px',
              lineHeight: 1.7,
              color: tokens.colorNeutralForeground2,
              maxWidth: '560px',
            }}
          >
            一次翻译会把整篇切成若干批，每批发一次请求。<b>批越大越快</b>
            ——省掉的是每段各自的网络往返和等待模型开口的时间。但有两个因素限制它：
            <b>模型单次最大输出</b>（译文与原文长度相当，中译英还会更长，超限就被截断）， 以及本程序 <b>5 分钟</b>
            的请求超时（批太大生成不完，这一批得重来）。
            <div style={{ marginTop: '6px' }}>
              按<b>单次最大输出</b>参考：4K → 1000 字 · 16K → 3000 字 · 32K → 4000 字 · 96K → 5000 字 · 128K → 6000
              字（再大基本只会先撞超时）
            </div>
            <div style={{ marginTop: '6px' }}>
              智谱免费模型（上下文 / 单次最大输出）：GLM-4.7-Flash 200K / 128K · GLM-4.5-Flash 128K / 96K · GLM-4-Flash
              128K / 16K · GLM-4-Long 1M / 4K。 注意决定批大小的是<b>单次最大输出</b>，不是上下文窗口。
            </div>
            <div style={{ marginTop: '6px' }}>
              填大了不会翻坏：真撞上输出上限时，这一批会自动拆成逐段重发，只是慢一点。
            </div>
          </div>
        </div>
      )}

      {/* 机翻引擎的单次上限是厂商规定的，这里只说明程序怎么处理，不给旋钮 */}
      {!usesModel && (
        <p style={{ margin: '2px 0 0', fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
          机器翻译引擎的单次长度上限由厂商规定，程序会按其上限自动分批、 超长段落自动切开后再拼接，无需手动设置批大小。
        </p>
      )}

      <div className={styles.field}>
        <Label htmlFor="tr_lang">默认目标语言</Label>
        <Dropdown
          id="tr_lang"
          value={currentLang?.name ?? targetLang}
          selectedOptions={[targetLang]}
          onOptionSelect={(_, d) => setTargetLang(d.optionValue ?? 'zh')}
          placeholder="请选择语言"
          style={{ minWidth: '160px', maxWidth: '220px' }}
        >
          {langs.map((l) => (
            <Option key={l.code} value={l.code} text={l.name}>
              {l.name}
            </Option>
          ))}
        </Dropdown>
        <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
          编辑页翻译时仍可临时改选其它语言
          {!usesModel && '；各引擎的语言码由程序自动换算，无需手工填代码'}
        </span>
      </div>

      {msg && (
        <MessageBar intent={msg.ok ? 'success' : 'error'} className={styles.feedback}>
          <MessageBarBody>
            <MessageBarTitle>{msg.ok ? '成功' : '失败'}</MessageBarTitle>
            {msg.text}
          </MessageBarBody>
        </MessageBar>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <Button appearance="primary" onClick={() => saveMut.mutate()} disabled={busy}>
          保存设置
        </Button>
        <Button onClick={() => testMut.mutate()} disabled={busy}>
          {testMut.isPending ? '测试中…' : '保存并测试连接'}
        </Button>
      </div>
    </Card>
  );
}
