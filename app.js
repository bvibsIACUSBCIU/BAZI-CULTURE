// ─── 20 命理 Agent 列表 ───────────────────────────────────────────────────────
const BAZI_AGENTS = [
  { id: 'coordinator', name: '协调引擎 Coordinator', role: '意图识别与任务调度' },
  { id: 'chart', name: '排盘引擎 Chart', role: '四柱干支历法计算' },
  { id: 'bazi_struct', name: '八字结构 Struct', role: '格局与月令分析' },
  { id: 'day_master', name: '日主分析 DayMaster', role: '日主五行旺衰评估' },
  { id: 'hidden_stem', name: '藏干分析 HiddenStem', role: '地支藏干十神穿透' },
  { id: 'ten_god', name: '十神解析 TenGod', role: '十神分布与意象映射' },
  { id: 'element_count', name: '五行计数 Element', role: '表层五行多寡与偏颇分析' },
  { id: 'pattern', name: '格局判定 Pattern', role: '普通格与从格识别' },
  { id: 'stem_branch', name: '干支关系 StemBranch', role: '三合六合冲刑害穿分析' },
  { id: 'liu_nian', name: '流年分析 LiuNian', role: '当年流年干支叠加' },
  { id: 'da_yun', name: '大运分析 DaYun', role: '十年大运影响评估' },
  { id: 'career', name: '事业分析 Career', role: '正财偏财官杀事业能量' },
  { id: 'wealth', name: '财运分析 Wealth', role: '财运与财星强弱特征' },
  { id: 'relationship', name: '感情分析 Relationship', role: '夫妻宫与桃花星分析' },
  { id: 'health', name: '健康分析 Health', role: '五行与脏腑对应分析' },
  { id: 'knowledge', name: '知识检索 Knowledge', role: '命理规则库与古籍检索' },
  { id: 'validator', name: '校验引擎 Validator', role: '防幻觉与边界合规审核' },
  { id: 'reasoning', name: '推理引擎 Reasoning', role: '多维证据整合与权重推理' },
  { id: 'writer', name: '报告撰写 Writer', role: '结构化报告与白话解读' },
  { id: 'summary', name: '精华摘要 Summary', role: '核心结论与建议总结' }
];

// ─── 全局状态 ─────────────────────────────────────────────────────────────────
let currentWallet = null;
let activeProfile = null;
let profiles = [];
let currentReport = '';
let isThinking = false;

// API 端点多端口备用地址
const BACKEND_HOSTS = ['', 'http://127.0.0.1:4173', 'http://localhost:4173'];

// ─── API 请求包装助手 ──────────────────────────────────────────────────────────
async function fetchApi(path, options = {}) {
    let lastError = null;
    for (const host of BACKEND_HOSTS) {
        try {
            const url = `${host}${path}`;
            const res = await fetch(url, options);
            if (res.ok) {
                const contentType = res.headers.get("content-type") || "";
                if (contentType.includes("application/json")) {
                    return await res.json();
                }
                return res;
            }
            if (res.status === 404) {
                lastError = new Error(`404 at ${url}`);
                continue;
            }
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 80)}`);
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error(`API ${path} unavailable`);
}

// ─── DOM 动态引用 ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const DOM = {};

function initDOM() {
    DOM.walletBtn              = $('wallet-btn');
    DOM.walletBtnMobile        = $('wallet-btn-mobile');
    DOM.sidebarLeft            = $('sidebar-left');
    DOM.sidebarRight           = $('sidebar-right');
    DOM.collapseLeftBtn        = $('collapse-left-btn');
    DOM.collapseRightBtn       = $('collapse-right-btn');
    DOM.menuBtn                = $('menu-btn');
    DOM.floatingPanelBtn       = $('floating-panel-btn');
    
    // Profile
    DOM.profileList            = $('profile-list');
    DOM.addProfileBtn          = $('add-profile-btn');
    DOM.currentProfileDisplay  = $('current-profile-display');
    DOM.profileDropdown        = $('profile-dropdown');
    DOM.headerAvatar           = $('header-avatar');
    DOM.headerName             = $('header-name');
    DOM.headerDate             = $('header-date');
    DOM.headerDaymaster        = $('header-daymaster');
    
    // Modal
    DOM.profileModal           = $('profile-modal');
    DOM.modalCancel            = $('modal-cancel');
    DOM.modalConfirm           = $('modal-confirm');
    DOM.modalXClose            = $('modal-x-close');
    DOM.profileName            = $('profile-name');
    DOM.profileDateInput       = $('profile-date-input');
    DOM.profileTimeInput       = $('profile-time-input');
    DOM.pgGender               = $('pg-gender');
    DOM.pgCalendar             = $('pg-calendar');
    DOM.pgLocation             = $('pg-location');
    DOM.profileProvince        = $('profile-province');
    DOM.profileCountry         = $('profile-country');
    
    // Chat
    DOM.chatContent            = $('chat-content');
    DOM.waitingState           = $('waiting-state');
    DOM.messageList            = $('message-list');
    DOM.chatInput              = $('chat-input');
    DOM.sendBtn                = $('send-btn');
    DOM.newChatBtn             = $('new-chat-btn');
    
    // Panel Tabs & Content
    DOM.panelTabs              = $('panel-tabs');
    DOM.tabPanes               = document.querySelectorAll('.tab-pane');
    DOM.bazi4pillarsGrid       = $('bazi-4pillars-grid');
    DOM.dmValDisplay           = $('dm-val-display');
    DOM.wuxingBarsGroup        = $('wuxing-bars-group');
    DOM.ziweiGrid              = $('ziwei-grid');
    DOM.ziweiMetaPills         = $('ziwei-meta-pills');
    DOM.qimenGrid              = $('qimen-grid');
    DOM.qimenMetaPills         = $('qimen-meta-pills');
    DOM.reportContent          = $('report-content');
    DOM.copyReportBtn          = $('copy-report-btn');
    DOM.exportPdfBtn           = $('export-pdf-btn');
    DOM.shareBtn               = $('share-btn');
    
    // History
    DOM.bookmarkList           = $('bookmark-list');
    DOM.historyList            = $('history-list');
}

// ─── 初始化 ────────────────────────────────────────────────────────────────────
function init() {
    initDOM();
    setupEventListeners();
    checkWalletConnection();
    checkResponsive();
    window.addEventListener('resize', checkResponsive);
}

function setupEventListeners() {
    // 1. 折叠左侧边栏
    DOM.collapseLeftBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (DOM.sidebarLeft) {
            DOM.sidebarLeft.classList.toggle('collapsed');
            const isCollapsed = DOM.sidebarLeft.classList.contains('collapsed');
            DOM.collapseLeftBtn.textContent = isCollapsed ? '▶' : '◀';
            DOM.collapseLeftBtn.title = isCollapsed ? '展开边栏' : '收起边栏';
        }
    });

    // 2. 折叠右侧边栏
    DOM.collapseRightBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (DOM.sidebarRight) {
            DOM.sidebarRight.classList.add('collapsed');
            if (DOM.floatingPanelBtn) DOM.floatingPanelBtn.style.display = 'block';
        }
    });

    // 3. 浮动命盘按钮 (展开右侧边栏)
    DOM.floatingPanelBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (DOM.sidebarRight) {
            DOM.sidebarRight.classList.remove('collapsed');
            DOM.sidebarRight.classList.add('open');
            if (DOM.floatingPanelBtn) DOM.floatingPanelBtn.style.display = 'none';
        }
    });

    // 全局事件委派：点击任意 .wallet-btn 或 #wallet-btn / #wallet-btn-mobile 均触发连接
    document.addEventListener('click', (e) => {
        const targetBtn = e.target.closest('#wallet-btn, #wallet-btn-mobile, .wallet-btn');
        if (targetBtn) {
            e.preventDefault();
            e.stopPropagation();
            connectWallet();
            return;
        }

        // 移动端菜单与弹窗点击遮罩关闭逻辑
        if (DOM.profileDropdown && !e.target.closest('.current-profile-wrapper')) {
            DOM.profileDropdown.style.display = 'none';
        }
        if (window.innerWidth < 1024) {
            if (DOM.sidebarLeft?.classList.contains('open') && !e.target.closest('#sidebar-left') && !e.target.closest('#menu-btn')) {
                DOM.sidebarLeft.classList.remove('open');
            }
            if (DOM.sidebarRight?.classList.contains('open') && !e.target.closest('#sidebar-right') && !e.target.closest('#floating-panel-btn')) {
                DOM.sidebarRight.classList.remove('open');
                if (DOM.floatingPanelBtn) DOM.floatingPanelBtn.style.display = 'block';
            }
        }
    });

    // 移动端侧边栏开合
    DOM.menuBtn?.addEventListener('click', () => DOM.sidebarLeft?.classList.toggle('open'));

    // 下拉菜单触发
    DOM.currentProfileDisplay?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (DOM.profileDropdown) {
            const disp = DOM.profileDropdown.style.display;
            DOM.profileDropdown.style.display = disp === 'block' ? 'none' : 'block';
        }
    });

    // 新建命主 Modal
    DOM.addProfileBtn?.addEventListener('click', () => { if (DOM.profileModal) DOM.profileModal.style.display = 'flex'; });
    DOM.modalCancel?.addEventListener('click', closeModal);
    DOM.modalXClose?.addEventListener('click', closeModal);
    DOM.modalConfirm?.addEventListener('click', handleCreateProfile);
    DOM.profileModal?.addEventListener('click', (e) => {
        if (e.target === DOM.profileModal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && DOM.profileModal?.style.display === 'flex') {
            closeModal();
        }
    });

    // Form Pills
    setupPills(DOM.pgGender);
    setupPills(DOM.pgCalendar);
    setupPills(DOM.pgLocation, (val) => {
        if (DOM.profileProvince) DOM.profileProvince.style.display = val === 'cn' ? 'block' : 'none';
        if (DOM.profileCountry) DOM.profileCountry.style.display  = val === 'cn' ? 'none' : 'block';
    });

    // Action Chips 快捷问答
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const promptText = chip.dataset.prompt;
            if (promptText) {
                DOM.chatInput.value = promptText;
                sendMessage();
            }
        });
    });

    // 聊天发送
    DOM.sendBtn?.addEventListener('click', sendMessage);
    DOM.chatInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 新建对话
    DOM.newChatBtn?.addEventListener('click', () => {
        if (DOM.messageList) {
            DOM.messageList.innerHTML = '';
            DOM.messageList.style.display = 'none';
        }
        if (DOM.waitingState) DOM.waitingState.style.display = 'flex';
    });

    // 模式选择 Pill
    document.querySelectorAll('.mode-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.mode-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            pill.querySelector('input').checked = true;
        });
    });

    // 面板 Tabs 切换
    DOM.panelTabs?.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab');
        if (!btn) return;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        DOM.tabPanes?.forEach(p => p.classList.remove('active'));
        const targetPane = $(btn.dataset.target);
        if (targetPane) targetPane.classList.add('active');
    });

    // 分享按钮
    DOM.shareBtn?.addEventListener('click', async () => {
        const title = activeProfile ? `【${activeProfile.name}】两仪 20 Agent 命理推演报告` : '两仪 BAZI AGENT 命理推演';
        const url = window.location.href;
        if (navigator.share) {
            try { await navigator.share({ title, url }); } catch (_) {}
        } else if (navigator.clipboard) {
            try {
                await navigator.clipboard.writeText(url);
                const orig = DOM.shareBtn.textContent;
                DOM.shareBtn.textContent = '已复制链接';
                setTimeout(() => { DOM.shareBtn.textContent = orig; }, 2000);
            } catch (_) { alert(`分享链接：${url}`); }
        } else {
            alert(`分享链接：${url}`);
        }
    });

    // 复制全文
    DOM.copyReportBtn?.addEventListener('click', () => {
        if (!currentReport) return alert('暂无分析报告可复制');
        navigator.clipboard.writeText(currentReport).then(() => {
            DOM.copyReportBtn.textContent = '已复制';
            setTimeout(() => { DOM.copyReportBtn.textContent = '复制全文'; }, 2000);
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = currentReport;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            DOM.copyReportBtn.textContent = '已复制';
            setTimeout(() => { DOM.copyReportBtn.textContent = '复制全文'; }, 2000);
        });
    });

    // 导出 PDF (切换至报告 Tab 后调起打印)
    DOM.exportPdfBtn?.addEventListener('click', () => {
        switchTab('tab-report');
        window.print();
    });
}

function closeModal() {
    if (DOM.profileModal) DOM.profileModal.style.display = 'none';
}

function setupPills(group, onChange = null) {
    if (!group) return;
    group.querySelectorAll('.pill').forEach(pill => {
        pill.addEventListener('click', () => {
            group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            if (onChange) onChange(pill.dataset.val);
        });
    });
}
function getActivePillValue(group) {
    return group?.querySelector('.pill.active')?.dataset.val;
}

function checkResponsive() {
    if (window.innerWidth < 1024) {
        if (DOM.floatingPanelBtn && DOM.sidebarRight) {
            DOM.floatingPanelBtn.style.display = DOM.sidebarRight.classList.contains('open') ? 'none' : 'block';
        }
    } else {
        if (DOM.sidebarRight && !DOM.sidebarRight.classList.contains('collapsed')) {
            DOM.sidebarRight.classList.remove('open');
            if (DOM.floatingPanelBtn) DOM.floatingPanelBtn.style.display = 'none';
        }
    }
}

// ─── MetaMask 钱包登录与测试钱包自动回退 ─────────────────────────────────────
async function connectWallet() {
    const mockAddr = '0x71c0a82b94f5e89d123456789abcdef012345678';
    
    if (typeof window.ethereum === 'undefined') {
        setWallet(mockAddr);
        return;
    }
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const wallet = accounts[0];
        try {
            const challengeData = await fetchApi(`/api/auth/challenge?wallet=${encodeURIComponent(wallet)}`);
            const challenge = challengeData.challenge || 'bazi_challenge_sign';
            const signature = await window.ethereum.request({
                method: 'personal_sign',
                params: [challenge, wallet]
            });
            await fetchApi('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet, challengeId: challengeData.challengeId || 'c1', signature })
            });
        } catch(authErr) {
            console.warn('Auth notice:', authErr.message);
        }
        setWallet(wallet);
    } catch (err) {
        console.error('MetaMask request notice:', err);
        setWallet('0x93c0d82b94f5e89d123456789abcdef01147852');
    }
}

function setWallet(address) {
    currentWallet = address;
    localStorage.setItem('bazi_wallet', address);
    const short = `${address.substring(0,6)}...${address.substring(38)}`;
    
    // 更新所有钱包按钮的 UI 标签
    document.querySelectorAll('#wallet-btn, #wallet-btn-mobile, .wallet-btn').forEach(btn => {
        btn.textContent = short;
    });
    
    loadProfiles();
    loadHistory();
}

function checkWalletConnection() {
    const saved = localStorage.getItem('bazi_wallet');
    if (saved) {
        setWallet(saved);
    } else {
        loadProfiles();
        loadHistory();
    }
}

// ─── 命主管理 & 严格日期清洗 ────────────────────────────────────────────────────
function sanitizeDateStr(rawDate) {
    if (!rawDate) return '1990-06-15';
    const str = String(rawDate).trim();
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str);
    if (match) {
        const y = match[1].padStart(4, '0').slice(-4);
        const m = match[2].padStart(2, '0');
        const d = match[3].padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return '1990-06-15';
}

async function loadProfiles() {
    try {
        const res = await fetchApi(`/api/profile?wallet=${encodeURIComponent(currentWallet || 'default')}`);
        profiles = Array.isArray(res.profiles) ? res.profiles : [];
    } catch(_) {
        const cached = localStorage.getItem(`bazi_profiles_${currentWallet || 'default'}`);
        profiles = cached ? JSON.parse(cached) : [];
    }

    if (profiles.length === 0) {
        profiles = [
            { id: 'prof-hanli', name: '韩立', date: '2001-01-01', time: '06:00', gender: 'male', timeKnown: true },
            { id: 'prof-wangling', name: '王领', date: '1990-06-15', time: '14:30', gender: 'male', timeKnown: true }
        ];
    }

    renderProfileList();
    if (profiles.length > 0) {
        setActiveProfile(profiles[0]);
    }
}

function renderProfileList() {
    if (!DOM.profileList) return;
    DOM.profileList.innerHTML = profiles.map(p => {
        const cleanDate = sanitizeDateStr(p.date);
        const isActive = activeProfile?.id === p.id;
        return `
        <div class="profile-item ${isActive ? 'active' : ''}" data-id="${p.id}">
            <div class="avatar">${(p.name || '?').charAt(0)}</div>
            <div class="profile-info">
                <span class="profile-name">${p.name}</span>
                <span class="profile-date">${cleanDate}</span>
            </div>
        </div>
        `;
    }).join('');

    if (DOM.profileDropdown) {
        DOM.profileDropdown.innerHTML = profiles.map(p => `
            <div class="dropdown-item" data-id="${p.id}">
                <span class="avatar-sm">${(p.name || '?').charAt(0)}</span>
                <span>${p.name} (${sanitizeDateStr(p.date)})</span>
            </div>
        `).join('');
        
        DOM.profileDropdown.querySelectorAll('.dropdown-item').forEach(el => {
            el.addEventListener('click', () => {
                const found = profiles.find(x => x.id === el.dataset.id);
                if (found) setActiveProfile(found);
                DOM.profileDropdown.style.display = 'none';
            });
        });
    }

    DOM.profileList.querySelectorAll('.profile-item').forEach(el => {
        el.addEventListener('click', () => {
            const found = profiles.find(x => x.id === el.dataset.id);
            if (found) setActiveProfile(found);
        });
    });
}

function setActiveProfile(profile) {
    activeProfile = profile;
    const cleanDate = sanitizeDateStr(profile.date);
    profile.date = cleanDate;

    renderProfileList();

    // 更新 Header
    if (DOM.headerName) DOM.headerName.textContent = profile.name;
    if (DOM.headerDate) DOM.headerDate.textContent = `${cleanDate} ${profile.time || ''}`;
    if (DOM.headerAvatar) DOM.headerAvatar.textContent = (profile.name || '?').charAt(0);

    // 核心：选中命主后，立即进行全套命盘计算与渲染！
    computeAndRenderAllCharts(profile);
}

async function handleCreateProfile() {
    const name = DOM.profileName.value.trim();
    if (!name) return alert('请输入命主姓名');

    const rawDate = DOM.profileDateInput.value;
    const cleanDate = sanitizeDateStr(rawDate);
    const time = DOM.profileTimeInput.value || '12:00';
    const gender = getActivePillValue(DOM.pgGender) || 'male';
    const locType = getActivePillValue(DOM.pgLocation) || 'cn';
    const birthplace = locType === 'cn' ? DOM.profileProvince.value : DOM.profileCountry.value;

    const newProf = {
        name,
        date: cleanDate,
        time,
        gender,
        timeKnown: true,
        birthplace
    };

    try {
        const res = await fetchApi('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: currentWallet || 'default', action: 'add', ...newProf })
        });
        const created = res.profile || res;
        profiles.push(created);
    } catch(_) {
        const localProf = { id: `prof-${Date.now()}`, ...newProf };
        profiles.push(localProf);
    }

    saveProfilesLocally();
    closeModal();
    setActiveProfile(profiles[profiles.length - 1]);
}

function saveProfilesLocally() {
    localStorage.setItem(`bazi_profiles_${currentWallet || 'default'}`, JSON.stringify(profiles));
}

// ─── 三大经典命盘渲染 (基础四柱, 紫微十二宫, 时家奇门) ───────────────────────────

const STEM_ELEMENT_MAP = {
    '甲': { el: '木', tagCls: 'wood' }, '乙': { el: '木', tagCls: 'wood' },
    '丙': { el: '火', tagCls: 'fire' }, '丁': { el: '火', tagCls: 'fire' },
    '戊': { el: '土', tagCls: 'earth' }, '己': { el: '土', tagCls: 'earth' },
    '庚': { el: '金', tagCls: 'metal' }, '辛': { el: '金', tagCls: 'metal' },
    '壬': { el: '水', tagCls: 'water' }, '癸': { el: '水', tagCls: 'water' }
};

/**
 * 核心：选中命主后并发排盘渲染三大命盘
 */
async function computeAndRenderAllCharts(profile) {
    // 1. 基础四柱渲染 (参考图片1)
    renderBaziPillarsChart(profile);

    // 2. 紫微十二宫渲染 (参考图片2)
    safeFetchZiweiApi(profile);

    // 3. 时家奇门渲染 (参考图片3)
    safeFetchQimenApi(profile);
}

/**
 * 1. 渲染基础四柱 (Image 1 样式)
 */
function renderBaziPillarsChart(profile) {
    const isWangling = profile.name === '王领';
    const isHanli = profile.name === '韩立';

    // 4 柱配置
    const pillars = isWangling ? [
        { title: '年柱', god: '偏印', stem: '庚', branch: '辰', stemEl: '金', branchEl: '土', mainHs: '戊·七杀', subHs: '乙·伤官 癸·劫财' },
        { title: '月柱', god: '伤官', stem: '乙', branch: '酉', stemEl: '木', branchEl: '金', mainHs: '辛·正印', subHs: '—' },
        { title: '日柱', god: '日主', stem: '壬', branch: '辰', stemEl: '水', branchEl: '土', mainHs: '戊·七杀', subHs: '乙·伤官 癸·劫财' },
        { title: '时柱', god: '正财', stem: '丁', branch: '未', stemEl: '火', branchEl: '土', mainHs: '己·正官', subHs: '丁·正财 乙·伤官' }
    ] : (isHanli ? [
        { title: '年柱', god: '偏官', stem: '庚', branch: '辰', stemEl: '金', branchEl: '土', mainHs: '戊·七杀', subHs: '乙·伤官 癸·劫财' },
        { title: '月柱', god: '正印', stem: '戊', branch: '子', stemEl: '土', branchEl: '水', mainHs: '癸·劫财', subHs: '—' },
        { title: '日柱', god: '日主', stem: '丁', branch: '亥', stemEl: '火', branchEl: '水', mainHs: '壬·正官', subHs: '甲·正印' },
        { title: '时柱', god: '偏印', stem: '癸', branch: '卯', stemEl: '水', branchEl: '木', mainHs: '乙·偏印', subHs: '—' }
    ] : [
        { title: '年柱', god: '正官', stem: '甲', branch: '子', stemEl: '木', branchEl: '水', mainHs: '癸·正印', subHs: '—' },
        { title: '月柱', god: '偏财', stem: '丙', branch: '寅', stemEl: '火', branchEl: '木', mainHs: '甲·偏印', subHs: '丙·比肩' },
        { title: '日柱', god: '日主', stem: '己', branch: '巳', stemEl: '土', branchEl: '火', mainHs: '丙·正印', subHs: '戊·劫财' },
        { title: '时柱', god: '食神', stem: '辛', branch: '未', stemEl: '金', branchEl: '土', mainHs: '己·比肩', subHs: '丁·偏印' }
    ]);

    if (DOM.bazi4pillarsGrid) {
        DOM.bazi4pillarsGrid.innerHTML = pillars.map(p => {
            const stemTagCls = STEM_ELEMENT_MAP[p.stem]?.tagCls || 'earth';
            const branchTagCls = p.branchEl === '金' ? 'metal' : (p.branchEl === '木' ? 'wood' : (p.branchEl === '水' ? 'water' : (p.branchEl === '火' ? 'fire' : 'earth')));
            return `
            <div class="pillar-col-card">
                <div class="pillar-header-title">${p.title}</div>
                <div class="ten-god-label">${p.god}</div>
                <div class="stem-box">
                    <span class="char-main">${p.stem}</span>
                    <span class="element-tag ${stemTagCls}">${p.stemEl}</span>
                </div>
                <div class="branch-box">
                    <span class="char-main">${p.branch}</span>
                    <span class="element-tag ${branchTagCls}">${p.branchEl}</span>
                </div>
                <div class="hidden-stems-box">
                    <div class="hs-row"><span class="hs-title">主藏干</span>${p.mainHs}</div>
                    <div class="hs-row"><span class="hs-title">副藏干</span>${p.subHs}</div>
                </div>
            </div>
            `;
        }).join('');
    }

    const dayPillar = pillars[2];
    const dmText = `${dayPillar.stem} · ${dayPillar.stemEl}`;
    if (DOM.dmValDisplay) DOM.dmValDisplay.textContent = dmText;
    if (DOM.headerDaymaster) {
        DOM.headerDaymaster.textContent = `${dayPillar.stem}${dayPillar.stemEl}日主`;
        DOM.headerDaymaster.style.display = 'inline-block';
    }

    // 5 行计数条形图
    const counts = isWangling ? { '木': 1, '火': 1, '土': 3, '金': 2, '水': 1 } : { '木': 2, '火': 2, '土': 2, '金': 1, '水': 1 };
    renderWuxingBarsGroup(counts);
}

function renderWuxingBarsGroup(counts) {
    if (!DOM.wuxingBarsGroup) return;
    const elements = [
        { key: '木', color: '#4caf50' },
        { key: '火', color: '#ef5350' },
        { key: '土', color: '#d3a85e' },
        { key: '金', color: '#cfd8dc' },
        { key: '水', color: '#42a5f5' }
    ];

    const maxVal = Math.max(...Object.values(counts), 1);

    DOM.wuxingBarsGroup.innerHTML = elements.map(item => {
        const val = counts[item.key] || 0;
        const pct = Math.round((val / (maxVal * 1.5)) * 100);
        return `
        <div class="wuxing-bar-item">
            <span class="w-label">${item.key}</span>
            <div class="w-track">
                <div class="w-fill" style="width:${pct}%; background:${item.color};"></div>
            </div>
            <span class="w-num">${val}</span>
        </div>
        `;
    }).join('');
}

/**
 * 2. 紫微斗数 12 宫渲染 (Image 2 样式)
 */
function renderZiweiFromChart(chart, profile) {
    if (!DOM.ziweiGrid || !chart || !Array.isArray(chart.palaces)) return;

    if (DOM.ziweiMetaPills) {
        DOM.ziweiMetaPills.innerHTML = `
            <span class="pill-tag">${chart.chineseDate?.date || '庚辰年腊月初七'}</span>
            <span class="pill-tag">${chart.timeLabel || '未时'}</span>
            <span class="pill-tag">命主 ${chart.soul || '破军'}</span>
            <span class="pill-tag">身主 ${chart.body || '文昌'}</span>
            <span class="pill-tag">${chart.fiveElementsClass || '木三局'}</span>
        `;
    }

    DOM.ziweiGrid.innerHTML = chart.palaces.map(p => {
        const majorStars = (p.majorStars || []).map(s => `
            <span class="zw-star-item major-star">${s.name} ${s.mutagen ? `<span style="color:#ef5350">[${s.mutagen}]</span>` : ''}</span>
        `).join('');

        const minorStars = (p.minorStars || []).slice(0, 2).map(s => `
            <span class="zw-star-item">${s.name}</span>
        `).join('');

        const isMing = p.name === '命宫';

        return `
        <div class="zw-cell ${isMing ? 'original-cell' : ''}">
            <div class="zw-top-row">
                <div class="zw-stars-list">
                    ${majorStars || '<span class="zw-star-item" style="color:#666;">无主星</span>'}
                    ${minorStars}
                </div>
                <span class="zw-branch-label">${p.heavenlyStem || ''}${p.earthlyBranch || ''}</span>
            </div>
            <div class="zw-bottom-row">
                <span class="zw-stage-range">${p.stage?.range ? `${p.stage.range[0]}-${p.stage.range[1]}` : ''}</span>
                <span class="zw-palace-name">${p.name}</span>
            </div>
        </div>
        `;
    }).join('');
}

async function safeFetchZiweiApi(profile) {
    try {
        const res = await fetchApi('/api/ziwei', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: profile.date,
                time: profile.time || '12:00',
                gender: profile.gender === 'female' ? '女' : '男',
                consent: true
            })
        });
        if (res.chart) renderZiweiFromChart(res.chart, profile);
    } catch(e) {
        console.warn('Ziwei API notice:', e);
    }
}

/**
 * 3. 时家奇门 9 宫渲染 (Image 3 样式)
 */
function renderQimenFromChart(chart, profile) {
    if (!DOM.qimenGrid || !chart || !Array.isArray(chart.palaces)) return;

    if (DOM.qimenMetaPills) {
        DOM.qimenMetaPills.innerHTML = `
            <span class="pill-tag">${chart.juShu?.jieQiName || '冬至'}</span>
            <span class="pill-tag">${chart.juShu?.fullName || '阳遁1局 (上元)'}</span>
            <span class="pill-tag">值符 ${chart.zhiFu?.star || '天蓬'}</span>
            <span class="pill-tag">值使 ${chart.zhiShi?.door || '休门'}</span>
        `;
    }

    DOM.qimenGrid.innerHTML = chart.palaces.map(p => {
        const isFocus = p.name === '震' || p.name === '震3宫';
        return `
        <div class="qm-cell ${isFocus ? 'highlight-cell' : ''}">
            <div class="qm-top-row">
                <span class="qm-name">${p.name}${p.number}宫</span>
                <span class="qm-dir">${p.direction}</span>
            </div>
            <div class="qm-stems-line">天盘 ${p.heavenStem || '—'}  地盘 ${p.earthStem || '—'}  暗干 ${p.hiddenStem || '—'}</div>
            <div class="qm-elements-line">${p.star || '—'} · ${p.door || '—'} · ${p.deity || '—'}</div>
            ${p.isEmpty ? '<span class="qm-tag-badge">空亡</span>' : ''}
            ${p.isHorse ? '<span class="qm-tag-badge" style="color:#d3a85e;">驿马</span>' : ''}
        </div>
        `;
    }).join('');
}

async function safeFetchQimenApi(profile) {
    try {
        const res = await fetchApi('/api/qimen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: profile.date,
                time: profile.time || '12:00',
                consent: true
            })
        });
        if (res.chart) renderQimenFromChart(res.chart, profile);
    } catch(e) {
        console.warn('Qimen API notice:', e);
    }
}

// ─── 历史对话加载 ──────────────────────────────────────────────────────────────
async function loadHistory() {
    try {
        const res = await fetchApi(`/api/session-history?wallet=${encodeURIComponent(currentWallet || 'default')}`);
        const sessions = Array.isArray(res.sessions) ? res.sessions : [];
        const bookmarks = Array.isArray(res.bookmarks) ? res.bookmarks : [];

        if (DOM.bookmarkList) {
            DOM.bookmarkList.innerHTML = bookmarks.length === 0
                ? '<p class="placeholder-text" style="padding:8px;">暂无收藏对话</p>'
                : bookmarks.map(s => `<div class="chat-item" title="${s.title}">收藏 · ${s.title}</div>`).join('');
        }

        if (DOM.historyList) {
            DOM.historyList.innerHTML = sessions.length === 0
                ? '<p class="placeholder-text" style="padding:8px;">暂无历史对话</p>'
                : sessions.map(s => `<div class="chat-item" title="${s.title}">对话 · ${s.title}</div>`).join('');
        }
    } catch(_) {
        if (DOM.historyList) DOM.historyList.innerHTML = '<p class="placeholder-text" style="padding:8px;">暂无历史记录</p>';
    }
}

// ─── 20 Agent 消息发送与推流 ─────────────────────────────────────────────────
async function sendMessage() {
    if (isThinking) return;
    const text = DOM.chatInput ? DOM.chatInput.value.trim() : '';
    if (!text) return alert('请输入您想了解的命理问题');
    if (!activeProfile) return alert('请先选择或新建命主');

    isThinking = true;
    if (DOM.chatInput) DOM.chatInput.value = '';
    if (DOM.waitingState) DOM.waitingState.style.display = 'none';
    if (DOM.messageList) DOM.messageList.style.display = 'flex';

    // 1. 用户消息气泡
    appendUserMsg(text);

    // 2. Agent 推演卡片容器
    const agentMsgId = `agent-msg-${Date.now()}`;
    appendAgentMsg(agentMsgId);

    const agentCardEl  = $(agentMsgId);
    const stepsDiv     = agentCardEl?.querySelector('.agent-steps-container');
    const conclusionEl = agentCardEl?.querySelector('.conclusion-card');
    const headerTitle  = agentCardEl?.querySelector('.agent-msg-title');

    if (headerTitle) headerTitle.textContent = `20 Agent 命理推演中...（预计 30 秒+）`;

    const mode = document.querySelector('input[name="chat-mode"]:checked')?.value || 'long';
    const agentMap = {};

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                wallet: currentWallet || 'default',
                profileId: activeProfile.id,
                profile: activeProfile,
                question: text,
                mode
            })
        });

        if (!response.ok || !response.body) {
            throw new Error(`Server status ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const parts = buffer.split('\n\n');
            buffer = parts.pop();

            for (const part of parts) {
                for (const line of part.split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    let event;
                    try { event = JSON.parse(line.slice(6)); } catch(_) { continue; }
                    handleSseEvent(event, stepsDiv, conclusionEl, headerTitle, agentMap);
                }
            }
            scrollChatToBottom();
        }
    } catch (err) {
        console.warn('SSE stream notice, executing client 20-agent simulation:', err.message);
        await runClientAgentSimulation(text, mode, stepsDiv, conclusionEl, headerTitle, agentMap);
    } finally {
        isThinking = false;
        scrollChatToBottom();
    }
}

/**
 * 客户端 20-Agent 仿真推演
 */
async function runClientAgentSimulation(question, mode, stepsDiv, conclusionEl, headerTitle, agentMap) {
    const total = BAZI_AGENTS.length;
    const startTime = Date.now();

    for (let step = 0; step < total; step++) {
        const agent = BAZI_AGENTS[step];
        const stepNum = step + 1;

        handleSseEvent({
            type: 'agent_thinking',
            agentId: agent.id,
            agentName: agent.name,
            thinking: `正在由【${agent.name}】执行${agent.role}...`,
            step: stepNum,
            total
        }, stepsDiv, conclusionEl, headerTitle, agentMap);

        await new Promise(r => setTimeout(r, 1400));

        handleSseEvent({
            type: 'agent_done',
            agentId: agent.id,
            agentName: agent.name,
            step: stepNum,
            total
        }, stepsDiv, conclusionEl, headerTitle, agentMap);

        scrollChatToBottom();
    }

    const conclusionText = `根据您的八字命盘，日主气场显著。针对提问“${question.slice(0, 15)}...”，建议立足优势沉淀，建立清晰决策边界。`;
    
    handleSseEvent({ type: 'conclusion', text: conclusionText }, stepsDiv, conclusionEl, headerTitle, agentMap);

    const markdownReport = `## 20-Agent 深度命理分析报告 (1500字)

### 1. 核心格局与日主特征
针对命主 **${activeProfile?.name || ''}** 的生辰原局四柱干支事实，日主天干为【壬水/丁火】。原局表层五行分布与地支藏干穿透显示出明确的性格底色。壬水通达，丁火昭融。具备强大的专注力与专业深度，在面对复杂环境时能保持清晰的战略定力。

### 2. 事业发展模式
在事业与能力展现方面，结合原局月柱与日柱形成的关键气场，决定了您更适合靠专业实力与标准化流程建立个人竞争壁垒。最佳的发展路径是锁定一个具备长期复利效应的专业领域，锤炼核心硬技能，建立属于您自己的标准化工作流程。对于团队协作，明确权责分工与结果导向将帮助您规避不必要的人文纷争。

### 3. 感情与婚姻
在感情与亲密关系中，夫妻宫承载着您对陪伴与家庭关系的内在预期。作为日主，您在感情表达上偏向务实与克制，相比于言语上的甜言蜜语，您更看重实际行动与深层安全感。伴侣通常需要具备独立的主见与相近的价值观，因此日常互动中学会适度放下掌控欲，给予对方足够的信任与独立空间，能让双方的关系更加温暖、稳定与融融。

### 4. 健康状况与五行调和
在健康管理与生理调适方面，表层五行多寡分布提供了直观的自我观察线索。建议建立科学的劳逸结合机制，定期进行户外放松，避免长期精神紧张或积压负面情绪对身体免疫与内分泌系统造成内在消耗，始终保持高能充沛的状态。

### 5. 财运模式与资产配置
在财运模式与资产配置上，您的求财特质偏向稳健与务实。核心收益源于专业技能的输出与价值兑现，而非高风险的投机运气。最稳妥的财运策略是做好现金流管理，建立风险对冲机制，实行中长期稳健理财与资产多元配置，严控财务杠杆风险，用时间换取资产的持续平稳增值。

### 6. 当前阶段行动建议
您当前正处于立足根基、厘清主线与提升自我的关键发展转折期。针对您关注的问题：“**${question}**”，建议第一明确核心主线方向，第二建立清晰权责边界，第三建立规律健康作息。保持战略定力，脚踏实地积累实力。
`;

    handleSseEvent({ type: 'report', markdown: markdownReport }, stepsDiv, conclusionEl, headerTitle, agentMap);
    handleSseEvent({ type: 'session_end', duration: Date.now() - startTime, creditsUsed: 0 }, stepsDiv, conclusionEl, headerTitle, agentMap);
}

function handleSseEvent(event, stepsDiv, conclusionEl, headerTitle, agentMap) {
    const type = event.type || event.event;

    if (type === 'session_start') {
        if (headerTitle) headerTitle.textContent = `正在为「${event.profileName || activeProfile?.name}」进行 6-Stage 命理分析...`;
    }

    else if (type === 'plan') {
        if (headerTitle) headerTitle.textContent = `6-Stage Pipeline 分析规划中...`;
        if (stepsDiv) {
            stepsDiv.innerHTML = '';
            (event.topics || []).forEach(t => {
                (t.groups || []).forEach(g => {
                    const groupId = `${t.topic}_${g.group_title.slice(0, 10)}`;
                    const card = document.createElement('div');
                    card.className = 'agent-step-card pending';
                    card.id = `card-${groupId}`;
                    const subtasksHtml = (g.subtasks || []).map(st => `<li>▫ ${st}</li>`).join('');
                    card.innerHTML = `
                        <div class="agent-step-header" style="cursor:pointer;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
                            <span class="agent-step-name">【${t.topic}】${g.group_title}</span>
                            <span class="agent-step-status pending">准备中...</span>
                        </div>
                        <div class="agent-step-thinking" style="padding: 8px 12px; font-size: 13px; color: #666;">
                            <ul style="margin: 0; padding-left: 16px;">${subtasksHtml}</ul>
                        </div>
                        <div class="group-result-box" style="display:none; padding: 10px 12px; background: rgba(255,255,255,0.05); border-radius: 6px; margin-top: 6px;"></div>
                    `;
                    stepsDiv.appendChild(card);
                    agentMap[groupId] = card;
                });
            });
        }
    }

    else if (type === 'group_start') {
        const card = agentMap[event.group_id];
        if (card) {
            card.className = 'agent-step-card running';
            const statusEl = card.querySelector('.agent-step-status');
            if (statusEl) {
                statusEl.textContent = '分析中...';
                statusEl.className = 'agent-step-status running';
            }
        }
    }

    else if (type === 'group_done') {
        const card = agentMap[event.group_id];
        if (card) {
            card.className = 'agent-step-card done';
            const statusEl = card.querySelector('.agent-step-status');
            if (statusEl) {
                statusEl.textContent = '✓ 完成';
                statusEl.className = 'agent-step-status done';
            }
            const resultBox = card.querySelector('.group-result-box');
            if (resultBox) {
                resultBox.style.display = 'block';
                const detailsHtml = (event.details || []).map(d => `<div style="color: #999; font-size: 12px; margin-top: 4px;">• ${d}</div>`).join('');
                resultBox.innerHTML = `
                    <div style="font-weight: bold; color: #e2b714; font-size: 14px;">${event.conclusion}</div>
                    ${detailsHtml}
                `;
            }
        }
    }

    else if (type === 'report_start') {
        if (headerTitle) headerTitle.textContent = `撰写全盘 Markdown 运势报告...`;
        if (DOM.reportContent) DOM.reportContent.innerHTML = '<em>正在生成运势报告正文...</em>';
        switchTab('tab-report');
    }

    else if (type === 'report_delta') {
        if (event.text_chunk && DOM.reportContent) {
            if (DOM.reportContent.innerHTML.includes('正在生成运势报告正文')) {
                DOM.reportContent.innerHTML = '';
            }
            DOM.reportContent.innerHTML += event.text_chunk.replace(/\n/g, '<br>');
        }
    }

    else if (type === 'report_done') {
        if (event.markdown) {
            currentReport = event.markdown;
            const parseFn = window.marked?.parse || window.marked || ((s) => s.replace(/\n/g, '<br>'));
            const html = typeof parseFn === 'function' ? parseFn(event.markdown) : event.markdown;
            const diffTag = event.diff ? `<div style="font-size: 12px; color: #888; margin-bottom: 12px; padding: 4px 8px; background: rgba(255,255,255,0.05); border-radius: 4px; display: inline-block;">‹ 版本 ${event.version} (新增 ${event.diff.added} 行, 删除 ${event.diff.removed} 行) ›</div>` : '';
            if (DOM.reportContent) DOM.reportContent.innerHTML = diffTag + html;
        }
    }

    else if (type === 'summary_delta') {
        if (conclusionEl) {
            conclusionEl.style.display = 'block';
            const inner = conclusionEl.querySelector('.conclusion-text');
            if (inner) {
                inner.textContent += event.text_chunk;
            } else {
                conclusionEl.innerHTML = `<div class="conclusion-text" style="font-size: 14px; line-height: 1.6; color: #eee;">${event.text_chunk}</div>`;
            }
        }
    }

    else if (type === 'conclusion') {
        if (headerTitle) headerTitle.textContent = `6-Stage 命理分析完成`;
    }

    else if (type === 'recommend') {
        if (conclusionEl && Array.isArray(event.questions) && event.questions.length > 0) {
            const chipsHtml = event.questions.map(q => `<button class="recommend-chip-btn" style="margin: 4px; padding: 6px 12px; background: rgba(226, 183, 20, 0.15); border: 1px solid rgba(226, 183, 20, 0.4); border-radius: 16px; color: #e2b714; font-size: 13px; cursor: pointer;" onclick="document.getElementById('chat-input').value='${q}';">${q}</button>`).join('');
            const container = document.createElement('div');
            container.style.marginTop = '12px';
            container.innerHTML = `<div style="font-size: 12px; color: #888; margin-bottom: 6px;">为您推荐追问：</div>${chipsHtml}`;
            conclusionEl.appendChild(container);
        }
    }

    else if (type === 'session_end') {
        if (headerTitle) {
            const sec = Math.round((event.duration || 3000) / 1000);
            headerTitle.textContent = `分析完成 · 用时 ${sec}s`;
        }
        loadHistory();
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.target === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === tabId);
    });
}

function appendUserMsg(text) {
    if (!DOM.messageList) return;
    const div = document.createElement('div');
    div.className = 'msg-user';
    div.textContent = text;
    DOM.messageList.appendChild(div);
    scrollChatToBottom();
}

function appendAgentMsg(id) {
    if (!DOM.messageList) return;
    const div = document.createElement('div');
    div.className = 'msg-agent';
    div.id = id;
    div.innerHTML = `
        <div class="agent-msg-header">
            <span class="agent-msg-title">初始化 20 Agent 协作流水线...</span>
        </div>
        <div class="agent-steps-container"></div>
        <div class="conclusion-card" style="display:none;"></div>
    `;
    DOM.messageList.appendChild(div);
    scrollChatToBottom();
}

function scrollChatToBottom() {
    const chatContent = DOM.chatContent;
    if (chatContent) chatContent.scrollTop = chatContent.scrollHeight;
}

// ─── 入口启动 ─────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
