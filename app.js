// ─── 服务端 6-Stage 推演进度（仅呈现 SSE 已确认的阶段） ─────────────────────────
const SIX_STAGE_LABELS = [
    '命盘事实校验', '专题规划', '证据推演', '动态报告', '摘要收敛', '追问建议'
];

// ─── 全局状态 ─────────────────────────────────────────────────────────────────
let currentWallet = null;
let activeProfile = null;
let profiles = [];
let currentReport = '';
let isThinking = false;
let editingProfileId = null;
let savedSessions = [];

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
    DOM.reportChartEvidence    = $('report-chart-evidence');
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
    setupEthereumListeners();
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

    // 全局事件委派：点击任意 .wallet-btn 或 #wallet-btn / #wallet-btn-mobile 触发连接或切换账户
    document.addEventListener('click', (e) => {
        const targetBtn = e.target.closest('#wallet-btn, #wallet-btn-mobile, .wallet-btn');
        if (targetBtn) {
            e.preventDefault();
            e.stopPropagation();
            if (currentWallet) {
                switchWalletAccount();
            } else {
                connectWallet();
            }
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
    DOM.addProfileBtn?.addEventListener('click', () => {
        editingProfileId = null;
        if (DOM.profileName) DOM.profileName.value = '';
        if (DOM.profileDateInput) DOM.profileDateInput.value = '1990-06-15';
        if (DOM.profileTimeInput) DOM.profileTimeInput.value = '12:00';
        const modalTitle = DOM.profileModal?.querySelector('.modal-title') || DOM.profileModal?.querySelector('h3');
        if (modalTitle) modalTitle.textContent = '新增命主档案';
        if (DOM.profileModal) DOM.profileModal.style.display = 'flex';
    });
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
    DOM.reportChartEvidence?.addEventListener('click', () => switchTab('tab-bazi'));

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

// ─── MetaMask 钱包登录与账号切换 / 自动回退 ─────────────────────────────────────
async function connectWallet() {
    if (typeof window.ethereum === 'undefined') {
        alert('未检测到兼容的钱包。请安装并解锁 MetaMask 后重试。');
        return;
    }
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const wallet = accounts[0];
        if (!wallet) throw new Error('未返回钱包地址');
        const challengeData = await fetchApi(`/api/auth/challenge?wallet=${encodeURIComponent(wallet)}`);
        const signature = await window.ethereum.request({ method: 'personal_sign', params: [challengeData.challenge, wallet] });
        const login = await fetchApi('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet, challengeId: challengeData.challengeId, signature })
        });
        if (!login?.account?.walletAddress) throw new Error('钱包签名验证失败');
        if (!login.account.username) {
            const username = window.prompt('首次注册：请输入用户名（最多 40 个字符）');
            if (!username?.trim()) throw new Error('已取消用户名登记');
            await fetchApi('/api/auth/username', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet, username: username.trim() })
            });
        }
        setWallet(wallet);
    } catch (err) {
        console.warn('Wallet connection cancelled or failed:', err.message);
        alert(`钱包未连接：${err.message || '请完成钱包签名验证后重试。'}`);
    }
}

async function switchWalletAccount() {
    if (typeof window.ethereum !== 'undefined') {
        try {
            await window.ethereum.request({
                method: 'wallet_requestPermissions',
                params: [{ eth_accounts: {} }]
            });
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            if (accounts && accounts[0]) {
                await connectWallet();
            }
        } catch (err) {
            console.warn('Switch account notice:', err);
        }
    }
}

function disconnectWallet() {
    currentWallet = null;
    activeProfile = null;
    profiles = [];
    savedSessions = [];
    localStorage.removeItem('bazi_wallet');
    document.querySelectorAll('#wallet-btn, #wallet-btn-mobile, .wallet-btn').forEach(btn => {
        btn.textContent = '连接钱包';
    });
    renderProfileList();
    loadHistory();
    renderUnconnectedState();
}

function setupEthereumListeners() {
    if (typeof window.ethereum !== 'undefined' && window.ethereum.on) {
        window.ethereum.on('accountsChanged', (accounts) => {
            if (accounts && accounts.length > 0) {
                console.log('MetaMask account changed; a new signature is required');
                disconnectWallet();
            } else {
                disconnectWallet();
            }
        });
    }
}

function setWallet(address) {
    currentWallet = address;
    localStorage.setItem('bazi_wallet', address);
    const short = `${address.substring(0,6)}...${address.substring(38)}`;
    
    document.querySelectorAll('#wallet-btn, #wallet-btn-mobile, .wallet-btn').forEach(btn => {
        btn.textContent = short;
    });
    
    loadProfiles();
    loadHistory();
}

function checkWalletConnection() {
    if (typeof window.ethereum === 'undefined') {
        currentWallet = null;
        activeProfile = null;
        profiles = [];
        savedSessions = [];
        document.querySelectorAll('#wallet-btn, #wallet-btn-mobile, .wallet-btn').forEach(btn => {
            btn.textContent = '连接钱包';
        });
        renderProfileList();
        loadHistory();
        renderUnconnectedState();
        return;
    }
    window.ethereum.request({ method: 'eth_accounts' }).then(accounts => {
        if (accounts?.[0]) connectWallet();
        else disconnectWallet();
    }).catch(disconnectWallet);
}

function renderUnconnectedState() {
    if (DOM.headerName) DOM.headerName.textContent = '未连接钱包';
    if (DOM.headerDate) DOM.headerDate.textContent = '点击右上角【连接钱包】签名';
    if (DOM.headerAvatar) DOM.headerAvatar.textContent = '?';
    if (DOM.headerDaymaster) DOM.headerDaymaster.textContent = '—';

    if (DOM.bazi4pillarsGrid) {
        DOM.bazi4pillarsGrid.innerHTML = `
            <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center; color: #888;">
                <div style="font-size: 2rem; margin-bottom: 8px;">🔒</div>
                <div style="font-size: 1rem; color: #eee; font-weight: 600; margin-bottom: 4px;">未连接签名钱包</div>
                <div style="font-size: 0.85rem;">钱包签名账户是所有数据的唯一凭证，请点击右上角【连接钱包】解锁个人命盘。</div>
            </div>
        `;
    }
    if (DOM.dmValDisplay) DOM.dmValDisplay.textContent = '—';
    if (DOM.wuxingBarsGroup) DOM.wuxingBarsGroup.innerHTML = '';

    if (DOM.ziweiGrid) {
        DOM.ziweiGrid.innerHTML = `
            <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center; color: #888;">
                <div style="font-size: 2rem; margin-bottom: 8px;">🔮</div>
                <div style="font-size: 1rem; color: #eee; font-weight: 600; margin-bottom: 4px;">紫微十二宫星盘未解锁</div>
                <div style="font-size: 0.85rem;">请先连接钱包并建立命主档案。</div>
            </div>
        `;
    }

    if (DOM.qimenGrid) {
        DOM.qimenGrid.innerHTML = `
            <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center; color: #888;">
                <div style="font-size: 2rem; margin-bottom: 8px;">☯️</div>
                <div style="font-size: 1rem; color: #eee; font-weight: 600; margin-bottom: 4px;">时家奇门九宫格未解锁</div>
                <div style="font-size: 0.85rem;">请先连接钱包并建立命主档案。</div>
            </div>
        `;
    }

    if (DOM.reportContent) {
        DOM.reportContent.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; color: #888;">
                <div style="font-size: 1.1rem; color: #eee; margin-bottom: 6px;">全盘运势报告待生成</div>
                <div>连接钱包选择命主后，点击提问即可获得 20 Agent 深度推演报告。</div>
            </div>
        `;
    }
}

function renderNoProfilesState() {
    if (DOM.headerName) DOM.headerName.textContent = '未新建命主';
    if (DOM.headerDate) DOM.headerDate.textContent = '点击左侧边栏 + 新建命主档案';
    if (DOM.headerAvatar) DOM.headerAvatar.textContent = '+';
    if (DOM.headerDaymaster) DOM.headerDaymaster.textContent = '—';

    if (DOM.bazi4pillarsGrid) {
        DOM.bazi4pillarsGrid.innerHTML = `
            <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center; color: #888;">
                <div style="font-size: 1rem; color: #eee; margin-bottom: 4px;">暂无选中的命主档案</div>
                <div style="font-size: 0.85rem;">请在左侧边栏点击【+】创建您的第一个生辰命主。</div>
            </div>
        `;
    }
    if (DOM.dmValDisplay) DOM.dmValDisplay.textContent = '—';
    if (DOM.wuxingBarsGroup) DOM.wuxingBarsGroup.innerHTML = '';
}

// ─── 命主管理 & 严格日期清洗 ────────────────────────────────────────────────────
function sanitizeDateStr(rawDate) {
    if (!rawDate) return '1990-06-15';
    const str = String(rawDate).trim();
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/.exec(str);
    if (match) {
        const y = match[1].padStart(4, '0').slice(-4);
        const m = match[2].padStart(2, '0');
        const d = match[3].padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return '1990-06-15';
}

async function loadProfiles() {
    if (!currentWallet) {
        profiles = [];
        activeProfile = null;
        renderProfileList();
        renderUnconnectedState();
        return;
    }

    try {
        const res = await fetchApi(`/api/profile?wallet=${encodeURIComponent(currentWallet)}`);
        profiles = Array.isArray(res.profiles) ? res.profiles : [];
    } catch(_) {
        const cached = localStorage.getItem(`bazi_profiles_${currentWallet}`);
        profiles = cached ? JSON.parse(cached) : [];
    }

    renderProfileList();
    if (profiles.length > 0) {
        setActiveProfile(profiles[0]);
    } else {
        activeProfile = null;
        renderNoProfilesState();
    }
}

function renderProfileList() {
    if (!DOM.profileList) return;

    if (!currentWallet) {
        DOM.profileList.innerHTML = '<div class="empty-state" style="padding:12px; color:#888; font-size:12px; text-align:center;">未连接钱包</div>';
        if (DOM.profileDropdown) DOM.profileDropdown.innerHTML = '<div class="dropdown-item">未连接钱包</div>';
        return;
    }

    if (profiles.length === 0) {
        DOM.profileList.innerHTML = '<div class="empty-state" style="padding:12px; color:#888; font-size:12px; text-align:center;">暂无命主档案 (点击 + 新建)</div>';
        if (DOM.profileDropdown) DOM.profileDropdown.innerHTML = '<div class="dropdown-item">暂无命主档案</div>';
        return;
    }

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
            <button class="profile-kebab-btn" title="更多操作" data-id="${p.id}">⋮</button>
            <div class="profile-menu-dropdown" id="profile-menu-${p.id}">
                <div class="profile-menu-item edit-btn" data-id="${p.id}">✏️ 编辑</div>
                <div class="profile-menu-item danger delete-btn" data-id="${p.id}">🗑️ 删除</div>
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
        el.addEventListener('click', (e) => {
            if (e.target.closest('.profile-kebab-btn') || e.target.closest('.profile-menu-dropdown')) return;
            const found = profiles.find(x => x.id === el.dataset.id);
            if (found) setActiveProfile(found);
        });
    });

    DOM.profileList.querySelectorAll('.profile-kebab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const menu = $(`profile-menu-${id}`);
            document.querySelectorAll('.profile-menu-dropdown').forEach(m => {
                if (m !== menu) m.classList.remove('show');
            });
            if (menu) menu.classList.toggle('show');
        });
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.profile-menu-dropdown').forEach(m => m.classList.remove('show'));
    });

    DOM.profileList.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.profile-menu-dropdown').forEach(m => m.classList.remove('show'));
            const p = profiles.find(x => x.id === btn.dataset.id);
            if (p) openEditProfileModal(p);
        });
    });

    DOM.profileList.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.profile-menu-dropdown').forEach(m => m.classList.remove('show'));
            handleDeleteProfile(btn.dataset.id);
        });
    });
}

function openEditProfileModal(p) {
    editingProfileId = p.id;
    if (DOM.profileName) DOM.profileName.value = p.name || '';
    if (DOM.profileDateInput) DOM.profileDateInput.value = sanitizeDateStr(p.date);
    if (DOM.profileTimeInput) DOM.profileTimeInput.value = p.time || '12:00';
    
    if (DOM.pgGender) {
        DOM.pgGender.querySelectorAll('.pill').forEach(pill => {
            pill.classList.toggle('active', pill.dataset.val === (p.gender || 'male'));
        });
    }

    const modalTitle = DOM.profileModal?.querySelector('.modal-title') || DOM.profileModal?.querySelector('h3');
    if (modalTitle) modalTitle.textContent = `编辑命主【${p.name}】`;
    if (DOM.profileModal) DOM.profileModal.style.display = 'flex';
}

async function handleDeleteProfile(id) {
    const p = profiles.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`确定要删除命主【${p.name}】吗？`)) return;

    try {
        const result = await fetchApi(`/api/profile?wallet=${encodeURIComponent(currentWallet || 'default')}&profileId=${encodeURIComponent(id)}`, { method: 'DELETE' });
        profiles = Array.isArray(result.profiles) ? result.profiles : profiles.filter(x => x.id !== id);
    } catch (error) {
        console.error('Profile deletion failed:', error);
        return alert('删除失败，请稍后重试。');
    }
    saveProfilesLocally();

    if (activeProfile?.id === id) {
        if (profiles.length > 0) {
            setActiveProfile(profiles[0]);
        } else {
            activeProfile = null;
            renderProfileList();
        }
    } else {
        renderProfileList();
    }
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
    const birthplace = locType === 'cn' ? DOM.profileProvince?.value : DOM.profileCountry?.value;

    if (editingProfileId) {
        const p = profiles.find(x => x.id === editingProfileId);
        if (p) {
            p.name = name;
            p.date = cleanDate;
            p.time = time;
            p.gender = gender;
            p.birthplace = birthplace;
            saveProfilesLocally();
            closeModal();
            setActiveProfile(p);
            editingProfileId = null;
            return;
        }
    }

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
const BRANCH_ELEMENT_MAP = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };

/**
 * 核心：选中命主后并发排盘渲染三大命盘
 */
async function computeAndRenderAllCharts(profile) {
    // 1. 基础四柱渲染：只消费服务端确定性历法计算结果
    await safeFetchBaziApi(profile);

    // 2. 紫微十二宫渲染 (参考图片2)
    safeFetchZiweiApi(profile);

    // 3. 时家奇门渲染 (参考图片3)
    safeFetchQimenApi(profile);
}

/**
 * 1. 渲染基础四柱 (Image 1 样式)
 */
function renderBaziPillarsChart(chart) {
    const titles = { year: '年柱', month: '月柱', day: '日柱', time: '时柱' };
    const pillars = Object.keys(titles).map(key => {
        const value = chart?.pillars?.[key];
        const hidden = chart?.tenGods?.branches?.[key]?.stems || [];
        const formatHidden = item => `${item.stem}·${item.name}`;
        return {
            title: titles[key], god: chart?.tenGods?.stems?.[key] || '—',
            stem: value?.[0] || '—', branch: value?.[1] || '—',
            stemEl: STEM_ELEMENT_MAP[value?.[0]]?.el || '—', branchEl: BRANCH_ELEMENT_MAP[value?.[1]] || '—',
            mainHs: hidden[0] ? formatHidden(hidden[0]) : '—',
            subHs: hidden.slice(1).map(formatHidden).join(' ') || '—'
        };
    });

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
    renderWuxingBarsGroup(chart?.elementCounts || {});
}

async function safeFetchBaziApi(profile) {
    try {
        const result = await fetchApi('/api/report', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: sanitizeDateStr(profile.date), time: profile.time, timeKnown: profile.timeKnown !== false, birthplace: profile.birthplace || '', consent: true })
        });
        if (!result?.chart) throw new Error('命盘数据为空');
        renderBaziPillarsChart(result.chart);
    } catch (error) {
        console.error('Bazi calculation failed:', error);
        renderNoProfilesState();
    }
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
        const pct = Math.round((val / maxVal) * 100);
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

// ─── 历史对话加载 & 收藏管理 ──────────────────────────────────────────────────
async function loadHistory() {
    if (!currentWallet) {
        savedSessions = [];
        renderHistoryUI();
        return;
    }
    try {
        const res = await fetchApi(`/api/session-history?wallet=${encodeURIComponent(currentWallet)}`);
        savedSessions = Array.isArray(res.sessions) ? res.sessions : [];
    } catch(_) {
        const cached = localStorage.getItem(`bazi_sessions_${currentWallet}`);
        savedSessions = cached ? JSON.parse(cached) : [];
    }

    renderHistoryUI();
}

function renderHistoryUI() {
    if (!currentWallet) {
        if (DOM.bookmarkList) DOM.bookmarkList.innerHTML = '<p class="placeholder-text" style="padding:8px; color: #888; font-size: 13px;">请连接钱包查看收藏</p>';
        if (DOM.historyList) DOM.historyList.innerHTML = '<p class="placeholder-text" style="padding:8px; color: #888; font-size: 13px;">请连接钱包查看历史</p>';
        return;
    }

    const bookmarks = savedSessions.filter(s => s.bookmarked);

    if (DOM.bookmarkList) {
        DOM.bookmarkList.innerHTML = bookmarks.length === 0
            ? '<p class="placeholder-text" style="padding:8px; color: #888; font-size: 13px;">暂无收藏对话</p>'
            : bookmarks.map(s => renderSessionItemHtml(s)).join('');
        bindSessionItemEvents(DOM.bookmarkList);
    }

    if (DOM.historyList) {
        DOM.historyList.innerHTML = savedSessions.length === 0
            ? '<p class="placeholder-text" style="padding:8px; color: #888; font-size: 13px;">暂无历史对话</p>'
            : savedSessions.map(s => renderSessionItemHtml(s)).join('');
        bindSessionItemEvents(DOM.historyList);
    }
}

function renderSessionItemHtml(s) {
    const timeStr = s.timestamp ? new Date(s.timestamp).toLocaleDateString() : '';
    return `
    <div class="chat-item-wrapper" data-id="${s.id}" title="${s.title}">
        <div class="chat-item-info">
            <span class="chat-item-title">${s.title}</span>
            <span class="chat-item-sub">${s.profileName || '命主'} ${timeStr ? '· ' + timeStr : ''}</span>
        </div>
        <button class="chat-item-star ${s.bookmarked ? 'active' : ''}" data-id="${s.id}" title="${s.bookmarked ? '取消收藏' : '收藏'}">
            ${s.bookmarked ? '★' : '☆'}
        </button>
    </div>
    `;
}

function bindSessionItemEvents(container) {
    if (!container) return;
    
    container.querySelectorAll('.chat-item-wrapper').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.chat-item-star')) return;
            const id = item.dataset.id;
            loadSessionDetail(id);
        });
    });

    container.querySelectorAll('.chat-item-star').forEach(starBtn => {
        starBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = starBtn.dataset.id;
            toggleSessionBookmark(id);
        });
    });
}

async function toggleSessionBookmark(sessionId) {
    if (!currentWallet) return;
    const s = savedSessions.find(x => x.id === sessionId);
    if (s) {
        s.bookmarked = !s.bookmarked;
        localStorage.setItem(`bazi_sessions_${currentWallet}`, JSON.stringify(savedSessions));
        renderHistoryUI();
    }

    try {
        await fetchApi('/api/session-history/bookmark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: currentWallet, sessionId })
        });
    } catch (_) {}
}

function loadSessionDetail(sessionId) {
    const s = savedSessions.find(x => x.id === sessionId);
    if (!s) return;

    if (DOM.waitingState) DOM.waitingState.style.display = 'none';
    if (DOM.messageList) {
        DOM.messageList.style.display = 'flex';
        DOM.messageList.innerHTML = '';
        
        appendUserMsg(s.question || s.title);
        
        const agentMsgId = `agent-msg-hist-${Date.now()}`;
        appendAgentMsg(agentMsgId);
        
        const agentCardEl = $(agentMsgId);
        const headerTitle = agentCardEl?.querySelector('.agent-msg-title');
        const conclusionEl = agentCardEl?.querySelector('.conclusion-card');
        
        if (headerTitle) headerTitle.textContent = `历史对话 · 命盘分析记录【${s.profileName || '命主'}】`;
        if (conclusionEl) {
            conclusionEl.style.display = 'block';
            conclusionEl.innerHTML = `<div style="font-size: 14px; line-height: 1.6; color: #eee;">${s.summary || '【运势概况】解析已完成，参阅右侧运势报告。'}</div>`;
        }
    }
    
    if (s.reportMarkdown && DOM.reportContent) {
        currentReport = s.reportMarkdown;
        const parseFn = window.marked?.parse || window.marked || ((str) => str.replace(/\n/g, '<br>'));
        DOM.reportContent.innerHTML = typeof parseFn === 'function' ? parseFn(s.reportMarkdown) : s.reportMarkdown;
        renderReportEvidenceLink(s.chartSummary);
        switchTab('tab-report');
    }
}

function renderReportEvidenceLink(chartSummary = '') {
    if (!DOM.reportChartEvidence) return;
    const profileName = activeProfile?.name || '当前命主';
    DOM.reportChartEvidence.hidden = false;
    DOM.reportChartEvidence.textContent = chartSummary
        ? `依据：${chartSummary} · 查看当前确定命盘`
        : `依据：${profileName}的当前确定命盘 · 查看基础四柱`;
}

async function addSessionToHistory(sessionData) {
    if (!currentWallet) return;
    const newSess = {
        id: `sess-${Date.now()}`,
        wallet: currentWallet,
        profileId: activeProfile?.id || 'default',
        profileName: activeProfile?.name || '命主',
        title: sessionData.title || (sessionData.question ? `解答: ${sessionData.question.slice(0, 15)}...` : '八字运势解读'),
        question: sessionData.question || sessionData.title || '',
        summary: sessionData.summary || '',
        reportMarkdown: sessionData.reportMarkdown || '',
        timestamp: new Date().toISOString(),
        bookmarked: false
    };

    savedSessions.unshift(newSess);
    localStorage.setItem(`bazi_sessions_${currentWallet}`, JSON.stringify(savedSessions));
    renderHistoryUI();

    try {
        await fetchApi('/api/session-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: currentWallet, action: 'add', ...newSess })
        });
    } catch (_) {}
}

// ─── 20 Agent 消息发送与推流 ─────────────────────────────────────────────────
async function sendMessage() {
    if (isThinking) return;
    if (!currentWallet) return alert('请先点击右上角【连接钱包】签名');
    if (!activeProfile) return alert('请先在左侧边栏点击【+】创建命主档案');
    const text = DOM.chatInput ? DOM.chatInput.value.trim() : '';
    if (!text) return alert('请输入您想了解的命理问题');

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

    if (headerTitle) headerTitle.textContent = '正在连接 6-Stage 命理推演服务...';

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
                mode,
                previousReport: currentReport || null
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
        console.warn('SSE stream failed:', err.message);
        if (headerTitle) headerTitle.textContent = '推演服务暂不可用';
        if (conclusionEl) {
            conclusionEl.style.display = 'block';
            conclusionEl.textContent = '未收到服务端推演结果，未生成报告。请稍后重试。';
        }
    } finally {
        isThinking = false;
        scrollChatToBottom();
    }
}

function formatStageTitle(index) {
    return `Stage ${index + 1} · ${SIX_STAGE_LABELS[index]}`;
}

function renderPipelineStages(stepsDiv) {
    if (!stepsDiv) return;
    stepsDiv.innerHTML = `<div class="pipeline-stage-list">${SIX_STAGE_LABELS.map((_, index) => `
        <div class="pipeline-stage pending" data-stage="${index}">
            <span>${formatStageTitle(index)}</span><span class="pipeline-stage-status">等待服务端事件</span>
        </div>`).join('')}</div>`;
}

function updatePipelineStage(stepsDiv, index, state) {
    const stage = stepsDiv?.querySelector(`.pipeline-stage[data-stage="${index}"]`);
    if (!stage) return;
    stage.className = `pipeline-stage ${state}`;
    const status = stage.querySelector('.pipeline-stage-status');
    if (status) status.textContent = state === 'done' ? '已确认' : '进行中';
}

function handleSseEvent(event, stepsDiv, conclusionEl, headerTitle, agentMap) {
    const type = event.type || event.event;

    if (type === 'session_start') {
        if (headerTitle) headerTitle.textContent = `正在为「${event.profileName || activeProfile?.name}」进行 6-Stage 命理分析...`;
        renderPipelineStages(stepsDiv);
        updatePipelineStage(stepsDiv, 0, 'done');
    }

    else if (type === 'plan') {
        if (headerTitle) headerTitle.textContent = `6-Stage Pipeline 分析规划中...`;
        if (stepsDiv) {
            updatePipelineStage(stepsDiv, 1, 'done');
            updatePipelineStage(stepsDiv, 2, 'running');
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
        updatePipelineStage(stepsDiv, 2, 'done');
        updatePipelineStage(stepsDiv, 3, 'running');
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
        updatePipelineStage(stepsDiv, 3, 'done');
        updatePipelineStage(stepsDiv, 4, 'running');
        if (event.markdown) {
            currentReport = event.markdown;
            const parseFn = window.marked?.parse || window.marked || ((s) => s.replace(/\n/g, '<br>'));
            const html = typeof parseFn === 'function' ? parseFn(event.markdown) : event.markdown;
            const diffTag = event.diff ? `<div style="font-size: 12px; color: #888; margin-bottom: 12px; padding: 4px 8px; background: rgba(255,255,255,0.05); border-radius: 4px; display: inline-block;">‹ 版本 ${event.version} (新增 ${event.diff.added} 行, 删除 ${event.diff.removed} 行) ›</div>` : '';
            if (DOM.reportContent) DOM.reportContent.innerHTML = diffTag + html;
            renderReportEvidenceLink();
        }
    }

    else if (type === 'summary_delta') {
        updatePipelineStage(stepsDiv, 4, 'running');
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
        updatePipelineStage(stepsDiv, 4, 'done');
        updatePipelineStage(stepsDiv, 5, 'done');
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
