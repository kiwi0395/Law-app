// LegalDoc Auditor - Main Application Logic


// Initialize Database
const db = new LegalDB();

// A document can belong to multiple lĩnh vực. Older records only have the
// singular `field` string, so fall back to that for backward compatibility.
function getDocFields(doc) {
    if (Array.isArray(doc.fields) && doc.fields.length > 0) return doc.fields;
    return doc.field ? [doc.field] : [];
}

function getCheckedFieldValues(boxEl) {
    return Array.from(boxEl.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

function setCheckedFieldValues(boxEl, fields) {
    const fieldSet = new Set(fields);
    boxEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = fieldSet.has(cb.value);
    });
}

function renderFieldBadges(fields) {
    if (!fields || fields.length === 0) return '<span class="badge badge-purple">Chưa phân loại</span>';
    return `<div class="field-badge-group">${fields.map(f => `<span class="badge badge-purple">${escapeHtml(f)}</span>`).join('')}</div>`;
}

// Single source of truth for the Lĩnh vực taxonomy — drives the upload/edit
// checkbox pickers, the Library/Timeline field filters, and the Library's
// main-field tabs, so a taxonomy change only needs to happen here once.
const DEFAULT_FIELD_HIERARCHY = [
    { group: 'Thuế', fields: [
        { value: 'Thuế GTGT', label: 'Thuế GTGT' },
        { value: 'Thuế TNDN', label: 'Thuế TNDN' },
        { value: 'Thuế TNCN', label: 'Thuế TNCN' },
        { value: 'Thuế nhà thầu', label: 'Thuế nhà thầu' },
        { value: 'Thuế Nhập khẩu', label: 'Thuế Nhập khẩu' },
        { value: 'Thuế tài nguyên', label: 'Thuế tài nguyên' },
        { value: 'Luật quản lý thuế', label: 'Luật quản lý thuế' },
        { value: 'Thuế TTĐB', label: 'Thuế TTĐB' }
    ]},
    { group: 'Kế toán', fields: [
        { value: 'Kế toán', label: 'Kế toán (chung)' },
        { value: 'Chế độ kế toán', label: 'Chế độ kế toán' },
        { value: 'Chuẩn mực kế toán', label: 'Chuẩn mực kế toán' }
    ]},
    { group: 'Kiểm toán', fields: [
        { value: 'Kiểm toán', label: 'Kiểm toán (chung)' },
        { value: 'Chuẩn mực kiểm toán', label: 'Chuẩn mực kiểm toán' },
        { value: 'Hồ sơ mẫu VACPA', label: 'Hồ sơ mẫu VACPA' }
    ]},
    { group: null, fields: [
        { value: 'BHXH - Tiền lương', label: 'BHXH - Tiền lương' }
    ]},
    { group: 'Doanh nghiệp', fields: [
        { value: 'Luật doanh nghiệp', label: 'Luật doanh nghiệp' },
        { value: 'Luật đầu tư', label: 'Luật đầu tư' },
        { value: 'Luật chứng khoán', label: 'Luật chứng khoán' }
    ]},
    { group: null, fields: [{ value: 'Tài sản cố định', label: 'Tài sản cố định' }] },
    { group: null, fields: [{ value: 'Trích lập dự phòng', label: 'Trích lập dự phòng' }] },
    { group: null, fields: [{ value: 'Hóa đơn chứng từ', label: 'Hóa đơn chứng từ' }] },
    { group: null, fields: [{ value: 'Pháp luật khác', label: 'Pháp luật khác (Bất động sản...)' }] }
];

function loadFieldHierarchy() {
    try {
        const stored = localStorage.getItem('legaldoc_field_hierarchy');
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.error("Lỗi khi nạp lĩnh vực từ localStorage:", e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_FIELD_HIERARCHY));
}

let FIELD_HIERARCHY = loadFieldHierarchy();

function saveFieldHierarchy(hierarchy) {
    try {
        localStorage.setItem('legaldoc_field_hierarchy', JSON.stringify(hierarchy));
        FIELD_HIERARCHY = hierarchy;
        
        // Refresh dynamic UI components
        initFieldTaxonomyUI();
        renderLibraryFieldTabs();
        
        // Refresh lists & views
        populateLibraryTable();
        if (state.activePage === 'timeline-page') renderTimeline();
        
        // Update Field configuration UI if open
        if (state.activePage === 'fields-page') {
            renderFieldsManagementUI();
        }
        
        // Trigger auto-sync if connected
        if (typeof triggerAutoSync === 'function') {
            triggerAutoSync();
        }
    } catch (e) {
        console.error("Lỗi khi lưu lĩnh vực:", e);
        alert("Lỗi khi lưu cấu hình lĩnh vực!");
    }
}


// Checkbox markup for the multi-select field pickers (Upload form, Edit modal)
function renderFieldCheckboxOptions() {
    return FIELD_HIERARCHY.map(section => {
        const groupLabel = section.group ? `<div class="field-checkbox-group-label">${escapeHtml(section.group)}</div>` : '';
        const items = section.fields.map(f =>
            `<label class="field-checkbox-item"><input type="checkbox" value="${escapeHtml(f.value)}"> ${escapeHtml(f.label)}</label>`
        ).join('');
        return groupLabel + items;
    }).join('');
}

// <option>/<optgroup> markup for the plain single-select field filters
function renderFieldSelectOptions() {
    return FIELD_HIERARCHY.map(section => {
        const items = section.fields.map(f => `<option value="${escapeHtml(f.value)}">${escapeHtml(f.label)}</option>`).join('');
        return section.group ? `<optgroup label="${escapeHtml(section.group)}">${items}</optgroup>` : items;
    }).join('');
}

// One "chuyên đề" tab per main field group — grouped sections become one tab
// covering all their sub-fields; standalone fields are their own tab.
function getMainFieldGroups() {
    return FIELD_HIERARCHY.map(section => ({
        key: section.group || section.fields[0].value,
        label: section.group || section.fields[0].label,
        values: section.fields.map(f => f.value)
    }));
}

// Populates the 4 taxonomy-driven UI surfaces from FIELD_HIERARCHY.
function initFieldTaxonomyUI() {
    document.getElementById('doc-field-box').innerHTML = renderFieldCheckboxOptions();
    document.getElementById('doc-edit-field-box').innerHTML = renderFieldCheckboxOptions();

    const filterFieldSelect = document.getElementById('filter-field');
    filterFieldSelect.innerHTML = '<option value="all">Tất cả lĩnh vực</option>' + renderFieldSelectOptions();

    const timelineFilterFieldSelect = document.getElementById('timeline-filter-field');
    timelineFilterFieldSelect.innerHTML = '<option value="all">Tất cả lĩnh vực</option>' + renderFieldSelectOptions();

    const relFilterFieldSelect = document.getElementById('rel-filter-field');
    if (relFilterFieldSelect) {
        relFilterFieldSelect.innerHTML = '<option value="all">Tất cả lĩnh vực</option>' + renderFieldSelectOptions();
    }
}

// Main-field "chuyên đề" tabs at the top of the Library page
function renderLibraryFieldTabs() {
    const container = document.getElementById('lib-field-tabs');
    const active = state.libraryActiveMainField || 'all';

    const tabsHtml = [`<button class="lib-field-tab${active === 'all' ? ' active' : ''}" data-key="all">Tất cả</button>`]
        .concat(getMainFieldGroups().map(g =>
            `<button class="lib-field-tab${active === g.key ? ' active' : ''}" data-key="${escapeHtml(g.key)}">${escapeHtml(g.label)}</button>`
        ));
    container.innerHTML = tabsHtml.join('');

    container.querySelectorAll('.lib-field-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            state.libraryActiveMainField = btn.getAttribute('data-key');
            renderLibraryFieldTabs();
            populateLibraryTable();
        });
    });
}

// --- "Cơ quan ban hành" (issuing authority) widget ---
// Shared by the Upload form and the Edit modal. Only relevant for Công văn /
// Khác documents. Resolves down to a single display string, e.g.
// "Thuế tỉnh Hà Nội", stored as-is on the document.
const AUTHORITY_DOCTYPES = ['Công văn', 'Khác'];

function setupAuthorityWidget(categoryId, provinceId, customId) {
    const categorySelect = document.getElementById(categoryId);
    const provinceInput = document.getElementById(provinceId);
    const customInput = document.getElementById(customId);

    categorySelect.addEventListener('change', () => {
        const val = categorySelect.value;
        provinceInput.style.display = (val === 'thue_tinh' || val === 'ubnd') ? 'block' : 'none';
        customInput.style.display = (val === 'bo_khac' || val === 'co_quan_khac') ? 'block' : 'none';
        if (provinceInput.style.display === 'none') provinceInput.value = '';
        if (customInput.style.display === 'none') customInput.value = '';
    });
}

function updateAuthorityGroupVisibility(groupId, docType) {
    document.getElementById(groupId).style.display = AUTHORITY_DOCTYPES.includes(docType) ? 'block' : 'none';
}

function getAuthorityValue(categoryId, provinceId, customId) {
    const category = document.getElementById(categoryId).value;
    const province = document.getElementById(provinceId).value.trim();
    const custom = document.getElementById(customId).value.trim();

    if (category === 'thue_tinh') return province ? `Thuế tỉnh ${province}` : '';
    if (category === 'ubnd') return province ? `UBND ${province}` : '';
    if (category === 'bo_khac' || category === 'co_quan_khac') return custom;
    return category; // 'Tổng cục Thuế' / 'Bộ Tài chính' / ''
}

function setAuthorityValue(categoryId, provinceId, customId, value) {
    const categorySelect = document.getElementById(categoryId);
    const provinceInput = document.getElementById(provinceId);
    const customInput = document.getElementById(customId);

    let category = '';
    let province = '';
    let custom = '';

    if (!value) {
        category = '';
    } else if (value === 'Tổng cục Thuế' || value === 'Bộ Tài chính') {
        category = value;
    } else if (value.startsWith('Thuế tỉnh ')) {
        category = 'thue_tinh';
        province = value.substring('Thuế tỉnh '.length);
    } else if (value.startsWith('UBND ')) {
        category = 'ubnd';
        province = value.substring('UBND '.length);
    } else {
        category = 'co_quan_khac';
        custom = value;
    }

    categorySelect.value = category;
    provinceInput.value = province;
    customInput.value = custom;
    provinceInput.style.display = (category === 'thue_tinh' || category === 'ubnd') ? 'block' : 'none';
    customInput.style.display = (category === 'bo_khac' || category === 'co_quan_khac') ? 'block' : 'none';
}

function resetAuthorityWidget(categoryId, provinceId, customId) {
    setAuthorityValue(categoryId, provinceId, customId, '');
}

// Application State
const state = {
    activePage: 'dashboard-page',
    currentDoc: null,
    currentNotes: [],
    documents: [],
    relations: [],
    zoomLevel: 100, // percentage
    theme: localStorage.getItem('theme') || 'dark',
    splitMode: false,
    splitDoc: null,
    openTabs: [], // documents currently open as tabs in the Viewer page
    activeTabId: null,
    libraryActiveMainField: 'all', // active "chuyên đề" tab on the Library page
    activeDashboardTab: 'recently-viewed'
};

// Temp uploads
let uploadedWordBlob = null;
let uploadedWordName = '';
let uploadedPdfBlob = null;
let uploadedPdfName = '';
let activeSelection = null;

// DOM Elements
const elements = {
    // Nav
    navItems: document.querySelectorAll('.nav-list .nav-item'),
    pages: document.querySelectorAll('.page-container'),
    headerTitle: document.getElementById('header-page-title'),
    themeToggle: document.getElementById('theme-toggle'),
    themeIcon: document.getElementById('theme-icon'),
    themeText: document.getElementById('theme-text'),
    globalSearch: document.getElementById('global-search'),

    // Dashboard
    statTotalDocs: document.getElementById('stat-total-docs'),
    statMainDocs: document.getElementById('stat-main-docs'),
    statOfficialDocs: document.getElementById('stat-official-docs'),
    statTotalNotes: document.getElementById('stat-total-notes'),
    recentDocsTable: document.getElementById('dashboard-recent-docs'),
    recentNotesList: document.getElementById('dashboard-recent-notes'),

    // Library
    filterField: document.getElementById('filter-field'),
    filterType: document.getElementById('filter-type'),
    filterSearch: document.getElementById('filter-search'),
    libraryDocsList: document.getElementById('library-docs-list'),

    // Upload
    dropZone: document.getElementById('drop-zone'),
    fileWordInput: document.getElementById('file-word-input'),
    wordPreview: document.getElementById('word-file-preview'),
    wordFilename: document.getElementById('word-filename'),
    wordFilesize: document.getElementById('word-filesize'),
    wordClearBtn: document.getElementById('word-clear-btn'),
    pdfDropZone: document.getElementById('pdf-drop-zone'),
    filePdfInput: document.getElementById('file-pdf-input'),
    pdfPreview: document.getElementById('pdf-file-preview'),
    pdfFilename: document.getElementById('pdf-filename'),
    pdfClearBtn: document.getElementById('pdf-clear-btn'),
    uploadForm: document.getElementById('upload-form'),
    docTypeSelect: document.getElementById('doc-type'),
    submitDocBtn: document.getElementById('submit-doc-btn'),

    // Viewer
    viewerOutline: document.getElementById('viewer-outline'),
    viewerDocTitle: document.getElementById('viewer-doc-title'),
    viewerDocBadge: document.getElementById('viewer-doc-badge'),
    viewerSearchInput: document.getElementById('viewer-search-input'),
    viewerZoomIn: document.getElementById('viewer-zoom-in'),
    viewerZoomOut: document.getElementById('viewer-zoom-out'),
    viewerPaperContent: document.getElementById('viewer-paper-content'),
    viewerNotesList: document.getElementById('viewer-notes-list'),

    // Annotation Popover
    popover: document.getElementById('annotation-popover'),
    popoverPreview: document.getElementById('popover-selected-preview'),
    popoverNoteText: document.getElementById('popover-note-text'),
    popoverSaveBtn: document.getElementById('popover-save-btn'),
    popoverCloseBtn: document.getElementById('popover-close-btn'),

    // Compare
    compareSelectA: document.getElementById('compare-select-a'),
    compareSelectB: document.getElementById('compare-select-b'),
    compareRunBtn: document.getElementById('compare-run-btn'),
    comparePaneATitle: document.getElementById('compare-pane-a-title'),
    comparePaneBTitle: document.getElementById('compare-pane-b-title'),
    comparePaneABody: document.getElementById('compare-pane-a-body'),
    comparePaneBBody: document.getElementById('compare-pane-b-body'),
};

// Initialize Application
async function initApp() {
    try {
        await db.init();
        initFieldTaxonomyUI();
        renderLibraryFieldTabs();
        setupTheme();
        setupNavigation();
        setupMobileNav();
        setupUploadHandlers();
        setupUploadRelationsUI();
        setupDocTypeTabsHandlers();
        setupViewerHandlers();
        setupCompareHandlers();
        setupSnippetCompare();
        setupRelationsHandlers();
        setupDocEditHandlers();
        setupTimelineHandlers();
        setupDashboardTabsHandlers();
        setupGlobalSearch();
        setupBackupHandlers();
        setupEditFieldItemModalHandlers();

        // Khởi tạo Google Drive Sync & Mobile Support
        if (typeof setupGDriveUIHandlers === 'function') {
            setupGDriveUIHandlers();
            setupGDriveSettingsHandlers();
            setupMobileSync();
            setTimeout(() => {
                initGoogleAuth();
                restoreGoogleDriveSession();
            }, 1000);
        }

        // Initial Data Load
        await reloadData();
        
        // Lucide icons render
        lucide.createIcons();
    } catch (err) {
        console.error("Lỗi khi khởi chạy ứng dụng:", err);
        alert("Không thể khởi động cơ sở dữ liệu cục bộ IndexedDB.");
    }
}

// Reload all data
async function reloadData() {
    try {
        state.documents = (await db.getAllDocuments()) || [];
    } catch (e) {
        console.error("Lỗi khi tải tài liệu từ DB:", e);
        state.documents = [];
    }

    try {
        if (typeof db.getAllRelations === 'function') {
            state.relations = (await db.getAllRelations()) || [];
        } else {
            console.warn("db.getAllRelations chưa được định nghĩa (lỗi cache?).");
            state.relations = [];
        }
    } catch (e) {
        console.error("Lỗi khi tải quan hệ từ DB:", e);
        state.relations = [];
    }

    updateDashboardStats();
    populateLibraryTable();
    populateCongVanTable();
    populateKhacTable();
    populateCompareDropdowns();
    renderTimeline();
    if (state.activePage === 'relations-page') {
        populateRelationDocSelects();
        renderRelationsDiagram();
    }

    // Tự động đồng bộ lên Drive
    if (typeof triggerAutoSync === 'function') {
        triggerAutoSync();
    }
}

// --- Sao lưu / Phục hồi dữ liệu (Backup / Restore) ---
// Toàn bộ documents/notes/relations được xuất ra 1 file .json. File đính kèm
// (PDF/Word blob) được mã hóa base64 (data URL) để nhét vừa trong JSON.
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return await res.blob();
}

async function exportBackup() {
    const [documents, notes, relations] = await Promise.all([
        db.getAllDocuments(), db.getAllNotes(), db.getAllRelations()
    ]);

    // Serialize any attached blobs into base64 data URLs
    for (const d of documents) {
        d.pdfBlob = (d.pdfBlob instanceof Blob) ? { __blob: true, dataUrl: await blobToDataUrl(d.pdfBlob) } : null;
        d.wordBlob = (d.wordBlob instanceof Blob) ? { __blob: true, dataUrl: await blobToDataUrl(d.wordBlob) } : null;
    }

    const payload = {
        app: 'LegalDocAuditor',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        counts: { documents: documents.length, notes: notes.length, relations: relations.length },
        documents, notes, relations,
        fieldHierarchy: FIELD_HIERARCHY
    };

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `legaldoc-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    alert(`Đã xuất sao lưu:\n- ${documents.length} văn bản\n- ${notes.length} ghi chú\n- ${relations.length} quan hệ\n\nHãy cất file này vào OneDrive/USB để an toàn.`);
}

async function importBackup(file) {
    let data;
    try {
        data = JSON.parse(await file.text());
    } catch (e) {
        alert("Không đọc được file. Hãy chọn đúng file sao lưu .json do app này xuất ra.");
        return;
    }
    if (!data || data.app !== 'LegalDocAuditor' || !Array.isArray(data.documents)) {
        alert("File không hợp lệ hoặc không phải file sao lưu của LegalDoc Auditor.");
        return;
    }

    const nDocs = data.documents.length;
    const nNotes = (data.notes || []).length;
    const nRels = (data.relations || []).length;
    const current = state.documents.length;
    const warn = current > 0
        ? `\n\n⚠️ Thao tác này sẽ THAY THẾ toàn bộ ${current} văn bản hiện có bằng dữ liệu trong file sao lưu. Dữ liệu hiện tại sẽ bị ghi đè.`
        : '';
    if (!confirm(`Phục hồi từ file sao lưu:\n- ${nDocs} văn bản\n- ${nNotes} ghi chú\n- ${nRels} quan hệ${warn}\n\nTiếp tục?`)) return;

    // Rebuild blobs from base64
    for (const d of data.documents) {
        d.pdfBlob = (d.pdfBlob && d.pdfBlob.__blob) ? await dataUrlToBlob(d.pdfBlob.dataUrl) : null;
        d.wordBlob = (d.wordBlob && d.wordBlob.__blob) ? await dataUrlToBlob(d.wordBlob.dataUrl) : null;
    }

    try {
        await db.replaceAll(data.documents, data.notes || [], data.relations || []);
    } catch (e) {
        console.error("Lỗi phục hồi:", e);
        alert("Có lỗi khi ghi dữ liệu phục hồi. Vui lòng thử lại.");
        return;
    }

    if (data.fieldHierarchy) {
        saveFieldHierarchy(data.fieldHierarchy);
    }

    state.openTabs = [];
    state.activeTabId = null;
    
    // Ngăn chặn triggerAutoSync thông thường khi reload
    const oldAutoSync = triggerAutoSync;
    triggerAutoSync = () => {}; 
    await reloadData();
    triggerAutoSync = oldAutoSync;

    // Thực hiện đồng bộ đè lên Cloud ngay lập tức để ghi đè file cũ trên Drive
    if (accessToken) {
        try {
            await syncWithGoogleDrive(true);
        } catch (err) {
            console.error("Lỗi ghi đè Drive sau phục hồi:", err);
        }
    }
    
    alert(`Phục hồi thành công!\n- ${nDocs} văn bản\n- ${nNotes} ghi chú\n- ${nRels} quan hệ`);
}

function setupBackupHandlers() {
    const exportBtn = document.getElementById('backup-export-btn');
    const importBtn = document.getElementById('backup-import-btn');
    const importInput = document.getElementById('backup-import-input');
    const clearBtn = document.getElementById('clear-database-btn');
    if (!exportBtn || !importBtn || !importInput) return;

    exportBtn.addEventListener('click', async () => {
        exportBtn.disabled = true;
        try { await exportBackup(); }
        catch (e) { console.error(e); alert("Có lỗi khi xuất sao lưu."); }
        finally { exportBtn.disabled = false; }
    });

    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            await importBackup(e.target.files[0]);
            e.target.value = ''; // cho phép chọn lại cùng file lần sau
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            if (!confirm("CẢNH BÁO: Thao tác này sẽ xóa SẠCH toàn bộ văn bản, ghi chú và mối quan hệ khỏi trình duyệt. Dữ liệu trên Google Drive liên kết cũng sẽ được làm trống. Bạn có chắc chắn muốn xóa sạch?")) return;
            
            clearBtn.disabled = true;
            try {
                await db.replaceAll([], [], []);
                
                state.openTabs = [];
                state.activeTabId = null;
                
                // Ngăn chặn triggerAutoSync thông thường khi reload
                const oldAutoSync = triggerAutoSync;
                triggerAutoSync = () => {}; 
                await reloadData();
                triggerAutoSync = oldAutoSync;

                // Đồng bộ làm trống dữ liệu lên Drive
                if (accessToken) {
                    try {
                        await syncWithGoogleDrive(true);
                    } catch (err) {
                        console.error("Lỗi xóa file trên Drive:", err);
                    }
                }
                alert("Đã xóa sạch toàn bộ dữ liệu cục bộ và trên Cloud thành công!");
            } catch (e) {
                console.error(e);
                alert("Lỗi khi xóa sạch dữ liệu.");
            } finally {
                clearBtn.disabled = false;
            }
        });
    }
}

// --- Theme Management ---
function setupTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    updateThemeUI();
    
    elements.themeToggle.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', state.theme);
        document.documentElement.setAttribute('data-theme', state.theme);
        updateThemeUI();
    });
}

// Update Theme Icons & Labels
function updateThemeUI() {
    if (state.theme === 'light') {
        elements.themeIcon.setAttribute('data-lucide', 'moon');
        elements.themeText.textContent = 'Giao diện Tối';
    } else {
        elements.themeIcon.setAttribute('data-lucide', 'sun');
        elements.themeText.textContent = 'Giao diện Sáng';
    }
    lucide.createIcons();
}

// --- Navigation Management ---
function setupNavigation() {
    elements.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPageId = item.getAttribute('data-target');
            switchPage(targetPageId);
            closeMobileOverlays(); // no-op on desktop widths, closes the drawer on mobile
        });
    });
}

// One shared backdrop closes whichever mobile overlay is open — the nav
// drawer, or (within the Viewer page) the outline/notes slide-in panels.
function closeMobileOverlays() {
    document.querySelector('.sidebar').classList.remove('mobile-open');
    document.getElementById('outline-sidebar')?.classList.add('collapsed');
    document.getElementById('notes-sidebar')?.classList.add('collapsed');
    document.getElementById('mobile-sidebar-backdrop').classList.remove('active');
}

function setupMobileNav() {
    const menuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('mobile-sidebar-backdrop');

    menuBtn.addEventListener('click', () => {
        sidebar.classList.add('mobile-open');
        backdrop.classList.add('active');
    });

    backdrop.addEventListener('click', closeMobileOverlays);
    backdrop.addEventListener('touchstart', (e) => {
        closeMobileOverlays();
        if (e.cancelable) e.preventDefault();
    }, { passive: false });
}

function switchPage(pageId) {
    elements.pages.forEach(page => {
        if (page.id === pageId) {
            page.classList.add('active');
        } else {
            page.classList.remove('active');
        }
    });

    elements.navItems.forEach(nav => {
        if (nav.getAttribute('data-target') === pageId) {
            nav.classList.add('active');
        } else {
            nav.classList.remove('active');
        }
    });

    state.activePage = pageId;
    
    // Update Header Title
    let title = "Tổng quan";
    if (pageId === 'library-page') title = "Thư viện văn bản pháp luật";
    if (pageId === 'congvan-page') title = "Công văn";
    if (pageId === 'khac-page') title = "Tài liệu khác";
    if (pageId === 'viewer-page') title = "Trình cứu văn bản & Ghi chú";
    if (pageId === 'compare-page') title = "Đối soát thay đổi văn bản";
    if (pageId === 'upload-page') title = "Tải lên & Nhập tài liệu";
    if (pageId === 'relations-page') title = "Sơ đồ quan hệ văn bản";
    if (pageId === 'timeline-page') title = "Timeline hiệu lực văn bản";
    if (pageId === 'fields-page') title = "Cấu hình Lĩnh vực Quy định";
    elements.headerTitle.textContent = title;

    // Trigger page-specific loads
    if (pageId === 'dashboard-page') {
        updateDashboardStats();
    } else if (pageId === 'library-page') {
        populateLibraryTable();
    } else if (pageId === 'congvan-page') {
        populateCongVanTable();
    } else if (pageId === 'khac-page') {
        populateKhacTable();
    } else if (pageId === 'compare-page') {
        populateCompareDropdowns();
    } else if (pageId === 'relations-page') {
        loadRelationsPage();
    } else if (pageId === 'timeline-page') {
        renderTimeline();
    } else if (pageId === 'fields-page') {
        renderFieldsManagementUI();
    }
}

// A "normal" note with no explanation text is just a color/format highlight
// — nothing to review — so it shouldn't show up in notes lists/counts.
// Legal-status note types (amended/abolished/supplemented/guided) always
// count since they represent a tracked change, not just styling.
function isTrackableNote(note) {
    return note.noteType !== 'normal' || !!(note.noteText && note.noteText.trim());
}

// --- Dashboard Logic ---
async function updateDashboardStats() {
    const docs = state.documents;
    elements.statTotalDocs.textContent = docs.length;

    // Main legal docs
    const mainDocs = docs.filter(d => ['Luật', 'Nghị định', 'Thông tư'].includes(d.docType)).length;
    elements.statMainDocs.textContent = mainDocs;

    // Official letters
    const officialDocs = docs.filter(d => ['Công văn', 'Quyết định'].includes(d.docType)).length;
    elements.statOfficialDocs.textContent = officialDocs;

    // Total notes count (color/format-only highlights aren't real notes)
    let notes = [];
    try {
        notes = (await db.getAllNotes()) || [];
    } catch (e) {
        console.error("Lỗi khi tải ghi chú từ DB:", e);
    }
    const trackableNotes = notes.filter(isTrackableNote);
    elements.statTotalNotes.textContent = trackableNotes.length;

    renderDashboardDocsTable();

    const sortedNotes = [...notes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
    elements.recentNotesList.innerHTML = '';
    
    if (sortedNotes.length === 0) {
        elements.recentNotesList.innerHTML = `
            <div class="empty-state" style="padding: 2rem 0;">
                <i data-lucide="sticky-note" class="empty-state-icon" style="width: 32px;"></i>
                <p style="font-size: 0.85rem;">Chưa có ghi chú nào được tạo</p>
            </div>
        `;
    } else {
        for (const note of sortedNotes) {
            const doc = docs.find(d => d.id === note.docId);
            const noteCard = document.createElement('div');
            noteCard.className = 'note-item';
            const dateStr = note.createdAt ? note.createdAt.substring(0, 10) : 'Chưa rõ';
            noteCard.innerHTML = `
                <div class="note-quote">"${note.selectedText.substring(0, 70)}${note.selectedText.length > 70 ? '...' : ''}"</div>
                <div class="note-text">${note.noteText}</div>
                <div class="note-date">Văn bản: ${doc ? doc.title : 'N/A'} (${dateStr})</div>
            `;
            elements.recentNotesList.appendChild(noteCard);
        }
    }
    lucide.createIcons();
}

function recordViewedDocument(id) {
    try {
        let viewed = JSON.parse(localStorage.getItem('legaldoc_recently_viewed')) || [];
        viewed = viewed.filter(vId => vId !== id);
        viewed.unshift(id);
        viewed = viewed.slice(0, 10);
        localStorage.setItem('legaldoc_recently_viewed', JSON.stringify(viewed));
    } catch (e) {
        console.error("Lỗi khi ghi nhận văn bản đã xem:", e);
    }
}

function renderDashboardDocsTable() {
    const tbody = elements.recentDocsTable;
    if (!tbody) return;
    
    tbody.innerHTML = '';
    const activeTab = state.activeDashboardTab || 'recently-viewed';
    let docs = [];
    const today = new Date();
    today.setHours(0,0,0,0);
    
    if (activeTab === 'recently-viewed') {
        const viewedIds = JSON.parse(localStorage.getItem('legaldoc_recently_viewed')) || [];
        viewedIds.forEach(id => {
            const doc = state.documents.find(d => d.id === Number(id));
            if (doc) docs.push(doc);
        });
        docs = docs.slice(0, 5);
    } else if (activeTab === 'recently-added') {
        docs = [...state.documents].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    } else if (activeTab === 'recently-issued') {
        docs = [...state.documents].sort((a, b) => {
            const dateA = parseVNDate(a.issueDate);
            const dateB = parseVNDate(b.issueDate);
            if (dateA && dateB) return dateB - dateA;
            if (dateA && !dateB) return -1;
            if (!dateA && dateB) return 1;
            return 0;
        }).slice(0, 5);
    } else if (activeTab === 'recently-expired') {
        docs = state.documents.filter(doc => {
            const expDate = parseVNDate(doc.expiryDate);
            return expDate && expDate < today;
        }).sort((a, b) => {
            const dateA = parseVNDate(a.expiryDate);
            const dateB = parseVNDate(b.expiryDate);
            return dateB - dateA;
        }).slice(0, 5);
    }
    
    if (docs.length === 0) {
        let msg = "Không có văn bản nào.";
        if (activeTab === 'recently-viewed') msg = "Chưa xem văn bản nào gần đây.";
        else if (activeTab === 'recently-added') msg = "Chưa có văn bản nào trong hệ thống.";
        else if (activeTab === 'recently-issued') msg = "Chưa có văn bản ban hành gần đây.";
        else if (activeTab === 'recently-expired') msg = "Chưa có văn bản nào hết hiệu lực gần đây.";
        
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">${msg}</td>
            </tr>
        `;
    } else {
        docs.forEach(doc => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${doc.number || 'Chưa rõ'}</strong></td>
                <td><span style="font-weight: 500;">${doc.title}</span>${renderExpiredBadge(doc)}</td>
                <td>${renderFieldBadges(getDocFields(doc))}</td>
                <td><span class="badge badge-blue">${doc.docType}</span></td>
                <td>
                    <button class="action-btn view-doc-btn" data-id="${doc.id}" title="Đọc văn bản"><i data-lucide="eye"></i></button>
                </td>
            `;
            tr.querySelector('.view-doc-btn').addEventListener('click', () => {
                openDocumentInViewer(doc.id);
            });
            tbody.appendChild(tr);
        });
    }
    lucide.createIcons();
}

function setupDashboardTabsHandlers() {
    const tabs = document.querySelectorAll('.dashboard-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.activeDashboardTab = tab.getAttribute('data-tab');
            renderDashboardDocsTable();
        });
    });
}

// --- Library Page Filter & Lists ---

// Shared row builder used by the Library table and the Công văn / Tài liệu
// khác tabs (which are just docType-filtered views over the same store).
// A red "Hết hiệu lực" badge for any document whose expiryDate has passed —
// shown everywhere a document is listed, not just the Timeline page.
function renderExpiredBadge(doc) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const info = getDocTimelineInfo(doc, today);
    if (info.status !== 'expired') return '';
    return `<span class="badge badge-rose" title="Hết hiệu lực từ ${formatVNDate(info.endDate)}" style="margin-left: 0.4rem;">Hết hiệu lực</span>`;
}

function createDocRow(doc, { showType = true, showAuthority = false } = {}) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td style="text-align: center; width: 40px;">
            <button class="action-btn toggle-fav-btn" data-id="${doc.id}" style="background: none; border: none; padding: 0.25rem; display: inline-flex; align-items: center; justify-content: center;" title="${doc.isFavorite ? 'Bỏ yêu thích' : 'Yêu thích'}">
                <i data-lucide="star" class="fav-star-icon" style="width: 16px; height: 16px; transition: all 0.2s; ${doc.isFavorite ? 'color: #f59e0b; fill: #f59e0b;' : 'color: var(--text-muted); fill: transparent;'}"></i>
            </button>
        </td>
        <td><strong>${doc.number || 'Chưa rõ'}</strong></td>
        <td><span style="font-weight: 500;">${doc.title}</span>${renderExpiredBadge(doc)}</td>
        <td>${renderFieldBadges(getDocFields(doc))}</td>
        ${showType ? `<td><span class="badge badge-blue">${doc.docType}</span></td>` : ''}
        ${showAuthority ? `<td>${doc.issuingAuthority ? escapeHtml(doc.issuingAuthority) : '<span style="color: var(--text-muted);">Chưa rõ</span>'}</td>` : ''}
        <td>${doc.issueDate || 'N/A'}</td>
        <td>
            <div style="display: flex; gap: 0.25rem;">
                <button class="action-btn view-btn" data-id="${doc.id}" title="Đọc văn bản"><i data-lucide="eye"></i></button>
                <button class="action-btn edit-btn" data-id="${doc.id}" title="Sửa thông tin"><i data-lucide="pencil"></i></button>
                <button class="action-btn compare-btn" data-id="${doc.id}" title="Chọn đối soát"><i data-lucide="git-compare"></i></button>
                <button class="action-btn delete-btn" data-id="${doc.id}" title="Xóa văn bản"><i data-lucide="trash-2" style="color: var(--danger-color);"></i></button>
            </div>
        </td>
    `;

    tr.querySelector('.toggle-fav-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = tr.querySelector('.toggle-fav-btn');
        const star = btn.querySelector('.fav-star-icon');
        const isFav = !doc.isFavorite;

        await db.setFavorite(doc.id, isFav);
        doc.isFavorite = isFav;

        if (isFav) {
            star.style.color = '#f59e0b';
            star.style.fill = '#f59e0b';
            btn.title = 'Bỏ yêu thích';
        } else {
            star.style.color = 'var(--text-muted)';
            star.style.fill = 'transparent';
            btn.title = 'Yêu thích';
        }

        if (typeof triggerAutoSync === 'function') {
            triggerAutoSync();
        }

        const favFilter = document.getElementById('filter-favorite');
        if (favFilter && favFilter.checked && !isFav) {
            populateLibraryTable();
        }
    });

    tr.querySelector('.view-btn').addEventListener('click', () => openDocumentInViewer(doc.id));
    tr.querySelector('.edit-btn').addEventListener('click', () => openDocEditModal(doc.id));
    tr.querySelector('.compare-btn').addEventListener('click', () => {
        elements.compareSelectA.value = doc.id;
        switchPage('compare-page');
    });
    tr.querySelector('.delete-btn').addEventListener('click', () => deleteDocument(doc.id));

    return tr;
}

function populateLibraryTable() {
    const fieldFilter = elements.filterField.value;
    const typeFilter = elements.filterType.value;
    const searchFilter = elements.filterSearch.value.toLowerCase().trim();
    const favFilter = document.getElementById('filter-favorite') ? document.getElementById('filter-favorite').checked : false;

    let filtered = state.documents;

    if (favFilter) {
        filtered = filtered.filter(d => d.isFavorite);
    }

    const activeMainField = state.libraryActiveMainField || 'all';
    if (activeMainField !== 'all') {
        const mainGroup = getMainFieldGroups().find(g => g.key === activeMainField);
        if (mainGroup) {
            filtered = filtered.filter(d => getDocFields(d).some(f => mainGroup.values.includes(f)));
        }
    }
    if (fieldFilter !== 'all') {
        filtered = filtered.filter(d => getDocFields(d).includes(fieldFilter));
    }
    if (typeFilter !== 'all') {
        filtered = filtered.filter(d => d.docType === typeFilter);
    }
    if (searchFilter !== '') {
        filtered = filtered.filter(d =>
            d.title.toLowerCase().includes(searchFilter) ||
            (d.number && d.number.toLowerCase().includes(searchFilter)) ||
            (d.parsedHtml && d.parsedHtml.toLowerCase().includes(searchFilter))
        );
    }

    elements.libraryDocsList.innerHTML = '';
    if (filtered.length === 0) {
        elements.libraryDocsList.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: var(--text-muted);">Không tìm thấy văn bản phù hợp.</td>
            </tr>
        `;
    } else {
        sortDocsByIssueDate(filtered).forEach(doc => elements.libraryDocsList.appendChild(createDocRow(doc)));
    }
    lucide.createIcons();
}

// Add filters listeners
elements.filterField.addEventListener('change', populateLibraryTable);
elements.filterType.addEventListener('change', populateLibraryTable);
if (document.getElementById('filter-favorite')) {
    document.getElementById('filter-favorite').addEventListener('change', populateLibraryTable);
}
elements.filterSearch.addEventListener('input', populateLibraryTable);

// --- Công văn / Tài liệu khác tabs (docType-filtered views of the same library) ---
function populateDocTypeTable(tbodyId, searchInputId, docType, emptyMessage) {
    const tbody = document.getElementById(tbodyId);
    const searchFilter = document.getElementById(searchInputId).value.toLowerCase().trim();

    let filtered = state.documents.filter(d => d.docType === docType);
    if (searchFilter !== '') {
        filtered = filtered.filter(d =>
            d.title.toLowerCase().includes(searchFilter) ||
            (d.number && d.number.toLowerCase().includes(searchFilter)) ||
            (d.parsedHtml && d.parsedHtml.toLowerCase().includes(searchFilter))
        );
    }
    filtered = sortDocsByIssueDate(filtered);

    tbody.innerHTML = '';
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">${emptyMessage}</td></tr>`;
    } else {
        filtered.forEach(doc => tbody.appendChild(createDocRow(doc, { showType: false, showAuthority: true })));
    }
    lucide.createIcons();
}

function populateCongVanTable() {
    populateDocTypeTable('congvan-docs-list', 'congvan-filter-search', 'Công văn', 'Chưa có công văn nào được tải lên.');
}

function populateKhacTable() {
    populateDocTypeTable('khac-docs-list', 'khac-filter-search', 'Khác', 'Chưa có tài liệu nào được tải lên.');
}

function setupDocTypeTabsHandlers() {
    document.getElementById('congvan-filter-search').addEventListener('input', populateCongVanTable);
    document.getElementById('khac-filter-search').addEventListener('input', populateKhacTable);

    document.getElementById('congvan-add-btn').addEventListener('click', () => {
        elements.docTypeSelect.value = 'Công văn';
        updateAuthorityGroupVisibility('doc-authority-group', 'Công văn');
        switchPage('upload-page');
    });
    document.getElementById('khac-add-btn').addEventListener('click', () => {
        elements.docTypeSelect.value = 'Khác';
        updateAuthorityGroupVisibility('doc-authority-group', 'Khác');
        switchPage('upload-page');
    });
}

async function deleteDocument(id) {
    if (confirm("Bạn có chắc chắn muốn xóa văn bản này cùng toàn bộ ghi chú liên quan?")) {
        // Clean up any relations referencing this document to avoid orphaned links
        const relatedRelations = await db.getRelationsForDoc(id);
        for (const rel of relatedRelations) {
            await db.deleteRelation(rel.id);
        }

        await db.deleteDocument(id);
        state.relations = await db.getAllRelations();
        await reloadData();
        if (state.activePage === 'relations-page') {
            renderRelationsDiagram();
        }
        if (state.openTabs.some(t => t.id === Number(id))) {
            closeViewerTab(Number(id));
        }
    }
}

// --- Edit Document Modal ---
function setupDocEditHandlers() {
    const overlay = document.getElementById('doc-edit-modal-overlay');
    const closeBtn = document.getElementById('doc-edit-modal-close');
    const saveBtn = document.getElementById('doc-edit-save-btn');
    const typeSelect = document.getElementById('doc-edit-type');

    setupAuthorityWidget('doc-edit-authority-category', 'doc-edit-authority-province', 'doc-edit-authority-custom');
    typeSelect.addEventListener('change', () => {
        updateAuthorityGroupVisibility('doc-edit-authority-group', typeSelect.value);
        if (!AUTHORITY_DOCTYPES.includes(typeSelect.value)) {
            resetAuthorityWidget('doc-edit-authority-category', 'doc-edit-authority-province', 'doc-edit-authority-custom');
        }
    });

    function closeModal() {
        overlay.style.display = 'none';
    }

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    saveBtn.addEventListener('click', async () => {
        const id = Number(overlay.getAttribute('data-editing-id'));
        const title = document.getElementById('doc-edit-title').value.trim();
        const docType = typeSelect.value;
        const selectedFields = getCheckedFieldValues(document.getElementById('doc-edit-field-box'));

        if (!title) {
            alert("Vui lòng nhập tên văn bản!");
            return;
        }
        if (selectedFields.length === 0) {
            alert("Vui lòng chọn ít nhất một lĩnh vực cho văn bản!");
            return;
        }

        await db.updateDocument(id, {
            title: title,
            number: document.getElementById('doc-edit-number').value.trim(),
            docType: docType,
            fields: selectedFields,
            issueDate: document.getElementById('doc-edit-issue-date').value.trim(),
            effectiveDate: document.getElementById('doc-edit-effective-date').value.trim(),
            expiryDate: document.getElementById('doc-edit-expiry-date').value.trim(),
            issuingAuthority: getAuthorityValue('doc-edit-authority-category', 'doc-edit-authority-province', 'doc-edit-authority-custom'),
            sourceUrl: document.getElementById('doc-edit-source-url').value.trim()
        });

        closeModal();
        await reloadData();

        // Keep the viewer in sync if the edited document is currently open
        if (state.currentDoc && state.currentDoc.id === id) {
            await openDocumentInViewer(id);
        }
    });
}

async function openDocEditModal(id) {
    const doc = await db.getDocument(id);
    if (!doc) return;

    const overlay = document.getElementById('doc-edit-modal-overlay');
    overlay.setAttribute('data-editing-id', id);

    document.getElementById('doc-edit-title').value = doc.title || '';
    document.getElementById('doc-edit-number').value = doc.number || '';
    document.getElementById('doc-edit-source-url').value = doc.sourceUrl || '';
    document.getElementById('doc-edit-type').value = doc.docType;
    setCheckedFieldValues(document.getElementById('doc-edit-field-box'), getDocFields(doc));
    document.getElementById('doc-edit-issue-date').value = doc.issueDate || '';
    document.getElementById('doc-edit-effective-date').value = doc.effectiveDate || '';
    document.getElementById('doc-edit-expiry-date').value = doc.expiryDate || '';
    updateAuthorityGroupVisibility('doc-edit-authority-group', doc.docType);
    setAuthorityValue('doc-edit-authority-category', 'doc-edit-authority-province', 'doc-edit-authority-custom', doc.issuingAuthority || '');

    overlay.style.display = 'flex';
}

// --- Global Search Input ---
function setupGlobalSearch() {
    elements.globalSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const val = elements.globalSearch.value;
            elements.filterSearch.value = val;
            switchPage('library-page');
            populateLibraryTable();
        }
    });
}

// --- Upload Form: Relations UI ---
// Lets the user link the document being uploaded to existing documents
// (huong_dan/sua_doi/bo_sung/bai_bo/thay_the) without leaving the Upload page.
function setupUploadRelationsUI() {
    document.getElementById('upload-rel-add-btn').addEventListener('click', () => {
        if (state.documents.length === 0) {
            alert("Chưa có văn bản nào khác trong hệ thống để liên kết quan hệ.");
            return;
        }
        document.getElementById('upload-relations-list').appendChild(createUploadRelationRow());
        lucide.createIcons();
    });
}

function createUploadRelationRow() {
    const row = document.createElement('div');
    row.className = 'upload-relation-row';

    const docOptions = sortDocsByIssueDate(state.documents).map(doc =>
        `<option value="${doc.id}">${escapeHtml(doc.number ? doc.number + ' - ' + doc.title : doc.title)}</option>`
    ).join('');

    row.innerHTML = `
        <div class="upload-relation-row-top">
            <select class="filter-select ur-role" style="flex: 1;">
                <option value="source">Văn bản này là Văn bản nguồn (VB hướng dẫn / sửa đổi / bổ sung...)</option>
                <option value="target">Văn bản này là Văn bản đích (VB được hướng dẫn / sửa đổi / bổ sung...)</option>
            </select>
            <button type="button" class="action-btn ur-remove" style="width: 28px; height: 28px; padding: 2px; flex-shrink: 0;"><i data-lucide="x" style="width: 14px; color: var(--danger-color);"></i></button>
        </div>
        <select class="filter-select ur-type">
            <option value="huong_dan">Hướng dẫn thi hành</option>
            <option value="sua_doi">Sửa đổi</option>
            <option value="bo_sung">Bổ sung</option>
            <option value="bai_bo">Bãi bỏ</option>
            <option value="thay_the">Thay thế</option>
        </select>
        <select class="filter-select ur-doc">
            <option value="">-- Chọn văn bản liên quan --</option>
            ${docOptions}
        </select>
        <input type="text" class="form-input ur-note" placeholder="Ghi chú (không bắt buộc)">
    `;

    row.querySelector('.ur-remove').addEventListener('click', () => row.remove());
    return row;
}

// Validates and reads the relation rows out of the Upload form.
// Returns null (after alerting) if a row is missing its related document.
function collectUploadRelationRows() {
    const rows = document.querySelectorAll('#upload-relations-list .upload-relation-row');
    const result = [];
    for (const row of rows) {
        const role = row.querySelector('.ur-role').value;
        const relationType = row.querySelector('.ur-type').value;
        const otherDocId = row.querySelector('.ur-doc').value;
        const note = row.querySelector('.ur-note').value.trim();

        if (!otherDocId) {
            alert("Vui lòng chọn văn bản liên quan cho tất cả các dòng quan hệ đã thêm, hoặc bấm nút x để xóa dòng chưa hoàn chỉnh.");
            return null;
        }
        result.push({ role, relationType, otherDocId: Number(otherDocId), note });
    }
    return result;
}

// --- Upload Wizard & Parsing Handlers ---
function setupUploadHandlers() {
    setupAuthorityWidget('doc-authority-category', 'doc-authority-province', 'doc-authority-custom');
    elements.docTypeSelect.addEventListener('change', () => {
        const type = elements.docTypeSelect.value;
        updateAuthorityGroupVisibility('doc-authority-group', type);
        if (!AUTHORITY_DOCTYPES.includes(type)) {
            resetAuthorityWidget('doc-authority-category', 'doc-authority-province', 'doc-authority-custom');
        }
    });

    // Word Drop Zone
    elements.dropZone.addEventListener('click', () => elements.fileWordInput.click());
    
    elements.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.dropZone.classList.add('dragover');
    });
    
    elements.dropZone.addEventListener('dragleave', () => {
        elements.dropZone.classList.remove('dragover');
    });
    
    elements.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleWordFile(e.dataTransfer.files[0]);
        }
    });

    elements.fileWordInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleWordFile(e.target.files[0]);
        }
    });

    elements.wordClearBtn.addEventListener('click', () => {
        uploadedWordBlob = null;
        uploadedWordName = '';
        elements.wordPreview.style.display = 'none';
        elements.dropZone.style.display = 'flex';
        document.getElementById('doc-title').value = '';
    });

    // PDF Drop Zone
    elements.pdfDropZone.addEventListener('click', () => elements.filePdfInput.click());
    
    elements.pdfDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.pdfDropZone.classList.add('dragover');
    });
    
    elements.pdfDropZone.addEventListener('dragleave', () => {
        elements.pdfDropZone.classList.remove('dragover');
    });
    
    elements.pdfDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.pdfDropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handlePdfFile(e.dataTransfer.files[0]);
        }
    });

    elements.filePdfInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handlePdfFile(e.target.files[0]);
        }
    });

    elements.pdfClearBtn.addEventListener('click', () => {
        uploadedPdfBlob = null;
        uploadedPdfName = '';
        elements.pdfPreview.style.display = 'none';
        elements.pdfDropZone.style.display = 'flex';
    });

    // Save Form Submission
    elements.uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const pastedText = document.getElementById('doc-paste-text').value.trim();
        if (!uploadedWordBlob && !uploadedPdfBlob && !pastedText) {
            alert("Vui lòng tải lên file Word (.docx), file PDF (.pdf), hoặc dán nội dung văn bản!");
            return;
        }

        const selectedFields = getCheckedFieldValues(document.getElementById('doc-field-box'));
        if (selectedFields.length === 0) {
            alert("Vui lòng chọn ít nhất một lĩnh vực cho văn bản!");
            return;
        }

        const relationRows = collectUploadRelationRows();
        if (relationRows === null) return;

        elements.submitDocBtn.disabled = true;
        elements.submitDocBtn.innerHTML = `<i data-lucide="loader" class="spin"></i> Đang xử lý...`;
        lucide.createIcons();

        try {
            // Content source priority: uploaded Word file > pasted text > none (PDF-only)
            let parsedHtml = '';
            if (uploadedWordBlob) {
                const arrayBuffer = await uploadedWordBlob.arrayBuffer();
                const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
                parsedHtml = result.value;
            } else if (pastedText) {
                parsedHtml = convertPlainTextToHtml(pastedText);
            }

            const docData = {
                title: document.getElementById('doc-title').value.trim(),
                number: document.getElementById('doc-number').value.trim(),
                docType: elements.docTypeSelect.value,
                fields: selectedFields,
                issueDate: document.getElementById('doc-issue-date').value,
                effectiveDate: document.getElementById('doc-effective-date').value,
                expiryDate: document.getElementById('doc-expiry-date').value,
                issuingAuthority: getAuthorityValue('doc-authority-category', 'doc-authority-province', 'doc-authority-custom'),
                sourceUrl: document.getElementById('doc-source-url').value.trim(),
                parsedHtml: parsedHtml,
                wordBlob: uploadedWordBlob,
                pdfBlob: uploadedPdfBlob
            };

            const docId = await db.addDocument(docData);

            // Create any relations the user linked to this new document
            for (const r of relationRows) {
                await db.addRelation({
                    sourceDocId: r.role === 'source' ? docId : r.otherDocId,
                    targetDocId: r.role === 'source' ? r.otherDocId : docId,
                    relationType: r.relationType,
                    note: r.note
                });
            }

            alert("Tải lên và lưu trữ văn bản pháp luật thành công!");

            // Reset
            elements.uploadForm.reset();
            resetAuthorityWidget('doc-authority-category', 'doc-authority-province', 'doc-authority-custom');
            updateAuthorityGroupVisibility('doc-authority-group', elements.docTypeSelect.value);
            uploadedWordBlob = null;
            uploadedWordName = '';
            uploadedPdfBlob = null;
            uploadedPdfName = '';
            elements.wordPreview.style.display = 'none';
            elements.dropZone.style.display = 'flex';
            elements.pdfPreview.style.display = 'none';
            elements.pdfDropZone.style.display = 'flex';
            document.getElementById('doc-paste-text').value = '';
            document.getElementById('upload-relations-list').innerHTML = '';

            await reloadData();
            openDocumentInViewer(docId);
        } catch (err) {
            console.error("Lỗi lưu văn bản:", err);
            alert("Không thể đọc và phân tích file Word. Hãy đảm bảo đó là file .docx hợp lệ.");
        } finally {
            elements.submitDocBtn.disabled = false;
            elements.submitDocBtn.innerHTML = `<i data-lucide="check"></i> Lưu văn bản pháp luật`;
            lucide.createIcons();
        }
    });
}

// Best-effort heuristics to pre-fill the upload form from the raw text of a .docx.
// Vietnamese legal documents follow a fairly consistent header shape:
//   Số: 181/2025/NĐ-CP              Hà Nội, ngày 1 tháng 7 năm 2025
//   NGHỊ ĐỊNH
//   Quy định chi tiết một số điều...
//   Căn cứ Luật... (this marks the end of the header/citation zone)
// Detection is intentionally conservative (restricted to the header area) so it
// doesn't pick up document numbers/dates cited later in "Căn cứ" clauses.
const DOC_TYPE_DETECT_MAP = {
    'NGHỊ ĐỊNH': 'Nghị định',
    'THÔNG TƯ': 'Thông tư',
    'CÔNG VĂN': 'Công văn',
    'QUYẾT ĐỊNH': 'Quyết định',
    'LUẬT': 'Luật'
};

function detectDocMetadataFromText(rawText) {
    const result = {};
    if (!rawText) return result;

    const allLines = rawText.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    const headerLines = allLines.slice(0, 40);
    const headerText = headerLines.join('\n');
    const canCuMatch = headerText.match(/Căn cứ /i);
    const headerZone = canCuMatch ? headerText.slice(0, canCuMatch.index) : headerText;

    // Loại văn bản + Tên văn bản: find the standalone keyword line, then the
    // title is the block of lines immediately following it.
    let typeLineIdx = -1;
    const typeKeys = Object.keys(DOC_TYPE_DETECT_MAP);
    for (let i = 0; i < Math.min(headerLines.length, 25); i++) {
        const upper = headerLines[i].toUpperCase();
        const key = typeKeys.find(k => upper === k || (upper.startsWith(k) && upper.length <= k.length + 15));
        if (key) {
            result.docType = DOC_TYPE_DETECT_MAP[key];
            typeLineIdx = i;
            break;
        }
    }
    if (typeLineIdx >= 0) {
        const titleParts = [];
        for (let i = typeLineIdx + 1; i < Math.min(headerLines.length, typeLineIdx + 6); i++) {
            const l = headerLines[i];
            if (/^(Căn cứ|Quốc hội|Chính phủ|Bộ trưởng|Thủ tướng)\s/i.test(l)) break;
            titleParts.push(l);
            if (titleParts.length >= 4) break;
        }
        if (titleParts.length > 0) {
            result.title = titleParts.join(' ').replace(/\s+/g, ' ').trim();
        }
    }

    // Số hiệu: e.g. "48/2024/QH15", "181/2025/NĐ-CP", "69/2025/TT-BTC"
    const numberMatch = headerZone.match(/(\d{1,4}[A-Za-z]?\/20\d{2}\/[A-ZĐ][A-ZĐ0-9\-]{1,14})/);
    if (numberMatch) result.number = numberMatch[1];

    // Ngày ban hành: prefer the "<Địa danh>, ngày D tháng M năm YYYY" signature
    // line (works for both the top header of Nghị định/Thông tư and the
    // signature block at the end of a Luật); fall back to a looser match
    // restricted to the header zone only.
    let dateMatch = rawText.match(/[A-ZÀ-Ỹ][A-Za-zÀ-Ỹà-ỹ.\s]{1,30},\s*ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/i);
    if (!dateMatch) {
        dateMatch = headerZone.match(/ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/i);
    }
    if (dateMatch) {
        const dd = String(dateMatch[1]).padStart(2, '0');
        const mm = String(dateMatch[2]).padStart(2, '0');
        result.issueDate = `${dd}/${mm}/${dateMatch[3]}`;
    }

    return result;
}

async function handleWordFile(file) {
    if (!file.name.endsWith('.docx')) {
        alert("Hệ thống chỉ hỗ trợ file Word định dạng .docx!");
        return;
    }
    uploadedWordBlob = file;
    uploadedWordName = file.name;

    // Auto title naming (immediate fallback from filename, may be replaced below)
    const cleanTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
    const titleInput = document.getElementById('doc-title');
    titleInput.value = cleanTitle;

    elements.wordFilename.textContent = file.name;
    elements.wordFilesize.textContent = (file.size / 1024).toFixed(1) + " KB";
    elements.dropZone.style.display = 'none';
    elements.wordPreview.style.display = 'flex';

    // Best-effort auto-detect từ nội dung file: Tên văn bản, Số hiệu, Loại văn bản, Ngày ban hành.
    // Kết quả chỉ là suy đoán theo cấu trúc thường gặp, người dùng nên kiểm tra lại trước khi lưu.
    try {
        const arrayBuffer = await file.arrayBuffer();
        const { value: rawText } = await mammoth.extractRawText({ arrayBuffer });
        const detected = detectDocMetadataFromText(rawText);

        if (detected.title && titleInput.value.trim() === cleanTitle.trim()) {
            titleInput.value = detected.title;
        }
        const numberInput = document.getElementById('doc-number');
        if (detected.number && !numberInput.value.trim()) {
            numberInput.value = detected.number;
        }
        const issueDateInput = document.getElementById('doc-issue-date');
        if (detected.issueDate && !issueDateInput.value.trim()) {
            issueDateInput.value = detected.issueDate;
        }
        if (detected.docType) {
            elements.docTypeSelect.value = detected.docType;
            elements.docTypeSelect.dispatchEvent(new Event('change'));
        }
    } catch (err) {
        console.warn("Không thể tự động nhận diện thông tin văn bản từ nội dung file:", err);
    }
}

function handlePdfFile(file) {
    if (!file.name.endsWith('.pdf')) {
        alert("Chỉ hỗ trợ file PDF!");
        return;
    }
    uploadedPdfBlob = file;
    uploadedPdfName = file.name;

    elements.pdfFilename.textContent = file.name;
    elements.pdfDropZone.style.display = 'none';
    elements.pdfPreview.style.display = 'flex';
}

// --- Split Screen Viewer & Outline generator ---
// --- Viewer Tabs ---
// Opening a document never closes what's already open — it activates an
// existing tab for it, or adds a new one — so following a reference link
// (e.g. "văn bản dẫn chiếu") keeps the original document's tab around.

// Switching back to a tab that was already open used to always land at the
// top of the document, forcing a re-scroll back to wherever the user was
// reading. This remembers each tab's scroll offset so switching back
// restores it instead.
const tabScrollPositions = new Map();

function saveActiveTabScrollPosition() {
    if (state.activeTabId === null || state.activeTabId === undefined) return;
    const scrollContainer = document.getElementById('viewer-column-main');
    if (scrollContainer) tabScrollPositions.set(state.activeTabId, scrollContainer.scrollTop);
}

function restoreTabScrollPosition(id) {
    const scrollContainer = document.getElementById('viewer-column-main');
    if (scrollContainer) scrollContainer.scrollTop = tabScrollPositions.get(id) || 0;
}
async function openDocumentInViewer(id) {
    id = Number(id);
    const doc = await db.getDocument(id);
    if (!doc) return;

    recordViewedDocument(id);

    // Always snapshot the current scroll before re-rendering — covers both
    // switching to another doc AND re-opening the same doc (e.g. right after
    // saving a note), so annotating no longer bounces the page to the top.
    saveActiveTabScrollPosition();

    const existingIndex = state.openTabs.findIndex(t => t.id === id);
    if (existingIndex !== -1) {
        state.openTabs[existingIndex] = doc; // refresh in case it was edited
    } else {
        state.openTabs.push(doc);
    }
    state.activeTabId = id;

    renderViewerTabs();
    await activateViewerTab(id);
    switchPage('viewer-page');
}

function renderViewerTabs() {
    const container = document.getElementById('viewer-tabs');
    container.innerHTML = '';

    state.openTabs.forEach(doc => {
        const colorKey = DOC_TYPE_ORDER.includes(doc.docType) ? doc.docType : 'Khác';
        const tab = document.createElement('div');
        tab.className = 'viewer-tab' + (doc.id === state.activeTabId ? ' active' : '');
        tab.setAttribute('data-doc-id', doc.id);
        tab.title = `${doc.number ? doc.number + ' - ' : ''}${doc.title}`;
        tab.innerHTML = `
            <span class="viewer-tab-dot" style="background: ${DOC_TYPE_COLORS[colorKey]};"></span>
            <span class="viewer-tab-title">${escapeHtml(doc.number || doc.title)}</span>
            <button class="viewer-tab-close" title="Đóng tab"><i data-lucide="x" style="width: 12px;"></i></button>
        `;

        tab.addEventListener('click', () => {
            if (doc.id === state.activeTabId) return;
            saveActiveTabScrollPosition();
            state.activeTabId = doc.id;
            renderViewerTabs();
            activateViewerTab(doc.id);
        });
        tab.querySelector('.viewer-tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeViewerTab(doc.id);
        });

        container.appendChild(tab);
    });

    lucide.createIcons();
}

function closeViewerTab(id) {
    const idx = state.openTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    state.openTabs.splice(idx, 1);
    tabScrollPositions.delete(id);

    if (state.activeTabId === id) {
        const next = state.openTabs[idx] || state.openTabs[idx - 1];
        state.activeTabId = next ? next.id : null;
    }

    renderViewerTabs();

    if (state.activeTabId) {
        activateViewerTab(state.activeTabId);
    } else {
        state.currentDoc = null;
        state.currentNotes = [];
        elements.viewerPaperContent.innerHTML = `<div class="empty-state"><i data-lucide="file" class="empty-state-icon"></i><h3>Chưa có tài liệu nào đang mở</h3><p>Vui lòng vào Thư viện chọn văn bản hoặc tải lên file mới.</p></div>`;
        elements.viewerOutline.innerHTML = '<li style="color: var(--text-muted); font-size: 0.85rem; padding: 1rem; text-align: center;">Vui lòng mở một văn bản</li>';
        elements.viewerDocTitle.textContent = "Chưa có văn bản nào đang mở";
        elements.viewerDocBadge.style.display = 'none';
        document.getElementById('viewer-source-link').style.display = 'none';
        document.getElementById('viewer-expired-banner').style.display = 'none';
        renderNotesList();
        const relPanel = document.getElementById('viewer-related-docs');
        if (relPanel) { relPanel.innerHTML = ''; relPanel.style.display = 'none'; }
        lucide.createIcons();
    }
}

async function activateViewerTab(id) {
    const doc = state.openTabs.find(t => t.id === id);
    if (!doc) return;

    state.currentDoc = doc;
    state.currentNotes = await db.getNotesForDoc(id);

    // Update Reader titles
    elements.viewerDocTitle.textContent = `${doc.number ? doc.number + ' - ' : ''}${doc.title}`;
    elements.viewerDocTitle.title = doc.title;
    elements.viewerDocBadge.textContent = doc.docType;
    elements.viewerDocBadge.style.display = 'inline-block';

    // "Xem online" link to the original source (thuvienphapluat.vn, etc.)
    const sourceLink = document.getElementById('viewer-source-link');
    if (doc.sourceUrl) {
        sourceLink.href = doc.sourceUrl;
        sourceLink.style.display = 'inline-flex';
    } else {
        sourceLink.style.display = 'none';
        sourceLink.removeAttribute('href');
    }

    // Warn prominently when the open document is no longer in effect
    const expiredBanner = document.getElementById('viewer-expired-banner');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const timelineInfo = getDocTimelineInfo(doc, today);
    if (timelineInfo.status === 'expired') {
        document.getElementById('viewer-expired-banner-text').textContent =
            `Văn bản này đã hết hiệu lực từ ngày ${formatVNDate(timelineInfo.endDate)}`;
        expiredBanner.style.display = 'flex';
    } else {
        expiredBanner.style.display = 'none';
    }

    // Show PDF or Word parsed content. Any document with an attached PDF opens
    // in the PDF view by default; the toggle to the extracted Word view only
    // appears when that document actually has parsed Word content to show.
    if (doc.pdfBlob) {
        const pdfUrl = URL.createObjectURL(doc.pdfBlob);
        const toggleBtnHtml = doc.parsedHtml
            ? `<button class="btn-primary" id="toggle-pdf-view-btn" style="width: auto; font-size: 0.8rem; padding: 0.4rem 0.8rem;"><i data-lucide="file-text"></i> Xem định dạng Word trích xuất</button>`
            : '';
        elements.viewerPaperContent.innerHTML = `
            <div style="height: 800px; width: 100%;">
                <div style="margin-bottom: 1rem; display: flex; gap: 0.5rem; justify-content: flex-end;">
                    ${toggleBtnHtml}
                </div>
                <iframe class="pdf-viewer-frame" src="${pdfUrl}"></iframe>
            </div>
        `;

        // Handle toggle back
        const toggleBtn = elements.viewerPaperContent.querySelector('#toggle-pdf-view-btn');
        toggleBtn?.addEventListener('click', () => {
            const htmlWithHeadings = renderContentAndOutline(doc.parsedHtml);
            elements.viewerPaperContent.innerHTML = htmlWithHeadings;
            applyNotesHighlights();
            renderNotesList();
        });

        elements.viewerOutline.innerHTML = doc.parsedHtml
            ? '<li style="color: var(--text-muted); font-size: 0.85rem; padding: 1rem; text-align: center;">Bấm "Xem định dạng Word trích xuất" để xem mục lục điều khoản</li>'
            : '<li style="color: var(--text-muted); font-size: 0.85rem; padding: 1rem; text-align: center;">Tài liệu này chỉ có bản PDF, không có mục lục điều khoản</li>';
    } else if (doc.parsedHtml) {
        const htmlWithHeadings = renderContentAndOutline(doc.parsedHtml);
        elements.viewerPaperContent.innerHTML = htmlWithHeadings;
        applyNotesHighlights();
    } else {
        elements.viewerPaperContent.innerHTML = `<div class="empty-state"><i data-lucide="file" class="empty-state-icon"></i><h3>Văn bản này chưa có nội dung file</h3></div>`;
        elements.viewerOutline.innerHTML = '<li style="color: var(--text-muted); font-size: 0.85rem; padding: 1rem; text-align: center;">Không có nội dung để hiển thị</li>';
    }

    // Render notes sidebar list + related-documents panel above it
    renderNotesList();
    renderRelatedDocsPanel(id);

    // If split mode is active, refresh the split select list
    if (state.splitMode) {
        populateSplitSelect();
        if (state.splitDoc && state.splitDoc.id === id) {
            state.splitDoc = null;
            document.getElementById('viewer-paper-content-split-body').innerHTML = `
                <div class="empty-state" style="padding: 2rem 0;">
                    <i data-lucide="book-open" class="empty-state-icon" style="width: 32px;"></i>
                    <p style="font-size: 0.85rem;">Chọn văn bản thứ hai từ danh sách phía trên để đọc song song.</p>
                </div>
            `;
            lucide.createIcons();
        }
    }

    restoreTabScrollPosition(id);
}

function renderContentAndOutline(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const elementsList = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p');
    
    const outline = [];
    let headingCounter = 0;

    elementsList.forEach((el, index) => {
        // Tag all paragraph/heading elements with indices
        el.setAttribute('data-p-index', index);

        const text = el.textContent.trim();
        const isHeading = el.tagName.startsWith('H');
        const isLegalSection = /^(Chương|Mục|Điều|Phần)\s+[0-9a-zA-Z]+/i.test(text);

        if (isHeading || isLegalSection) {
            el.classList.add('detected-heading');
            const headId = `heading-node-${headingCounter++}`;
            el.setAttribute('id', headId);
            
            let depth = 3;
            if (/^Phần/i.test(text) || el.tagName === 'H1') depth = 1;
            else if (/^Chương/i.test(text) || el.tagName === 'H2') depth = 1;
            else if (/^Mục/i.test(text) || el.tagName === 'H3') depth = 2;
            else if (/^Điều/i.test(text)) depth = 3;

            outline.push({
                id: headId,
                text: text.substring(0, 60) + (text.length > 60 ? '...' : ''),
                depth: depth
            });
        }
    });

    // Populate TOC
    elements.viewerOutline.innerHTML = '';
    if (outline.length === 0) {
        elements.viewerOutline.innerHTML = '<li style="color: var(--text-muted); font-size: 0.85rem; padding: 1rem; text-align: center;">Không phát hiện đề mục điều khoản</li>';
    } else {
        outline.forEach(item => {
            const li = document.createElement('li');
            li.className = `outline-item depth-${item.depth}`;
            li.setAttribute('data-heading-id', item.id);
            li.innerHTML = `<i data-lucide="chevron-right" style="width: 12px; margin-top: 2px;"></i> ${item.text}`;
            li.onclick = () => {
                const target = elements.viewerPaperContent.querySelector(`#${item.id}`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    document.querySelectorAll('.outline-item').forEach(liNode => liNode.classList.remove('active'));
                    li.classList.add('active');
                }
            };
            elements.viewerOutline.appendChild(li);
        });
        lucide.createIcons();
    }

    return doc.body.innerHTML;
}

// Highlight existing annotations
function applyNotesHighlights() {
    const parent = elements.viewerPaperContent;
    
    // Clear any existing supplement/guidance blocks from previous renders
    parent.querySelectorAll('.supplement-block').forEach(el => el.remove());

    state.currentNotes.forEach(note => {
        const targetEl = parent.querySelector(`[data-p-index="${note.paragraphIndex}"]`);
        if (targetEl) {
            const textContent = targetEl.textContent;
            
            // 1. Render Inline Highlights (for normal, amended, abolished, and guided notes)
            if (textContent.includes(note.selectedText)) {
                const selectionEscaped = escapeRegExp(note.selectedText);
                const regex = new RegExp(`(${selectionEscaped})`, 'g');
                
                // Build styles based on action type
                let styles = '';
                if (note.noteType === 'amended') {
                    styles += 'background-color: rgba(253, 224, 71, 0.9); color: #ef4444; ';
                } else if (note.noteType === 'abolished') {
                    styles += 'background-color: rgba(253, 224, 71, 0.9); color: #ef4444; text-decoration: underline; ';
                } else if (note.noteType === 'guided') {
                    styles += 'background-color: rgba(96, 165, 250, 0.35); color: #1e293b; ';
                } else {
                    if (note.highlightColor) styles += `background-color: ${note.highlightColor}; `;
                    if (note.textColor && note.textColor !== 'inherit') styles += `color: ${note.textColor}; `;
                    if (note.isBold) styles += `font-weight: bold; `;
                    if (note.isItalic) styles += `font-style: italic; `;
                    if (note.isUnderline) styles += `text-decoration: underline; `;
                }
                
                const titleAttr = note.noteText ? `title="${note.noteText.replace(/"/g, '&quot;')}"` : '';
                targetEl.innerHTML = targetEl.innerHTML.replace(regex, `<span class="highlight-note" data-note-id="${note.id}" style="${styles}" ${titleAttr}>$1</span>`);
            } else {
                targetEl.classList.add('highlight-note');
                targetEl.setAttribute('data-note-id', note.id);
                if (note.noteType === 'amended') {
                    targetEl.style.backgroundColor = 'rgba(253, 224, 71, 0.9)';
                    targetEl.style.color = '#ef4444';
                } else if (note.noteType === 'abolished') {
                    targetEl.style.backgroundColor = 'rgba(253, 224, 71, 0.9)';
                    targetEl.style.color = '#ef4444';
                    targetEl.style.textDecoration = 'underline';
                } else if (note.noteType === 'guided') {
                    targetEl.style.backgroundColor = 'rgba(96, 165, 250, 0.35)';
                    targetEl.style.color = '#1e293b';
                } else {
                    if (note.highlightColor) targetEl.style.backgroundColor = note.highlightColor;
                    if (note.textColor && note.textColor !== 'inherit') targetEl.style.color = note.textColor;
                    if (note.isBold) targetEl.style.fontWeight = 'bold';
                    if (note.isItalic) targetEl.style.fontStyle = 'italic';
                    if (note.isUnderline) targetEl.style.textDecoration = 'underline';
                }
            }

            // 2. Render Supplemental Blocks (specifically for supplemented notes)
            if (note.noteType === 'supplemented') {
                const refDoc = state.documents.find(d => d.id === Number(note.refDocId));
                const refLink = refDoc ? `<span class="ref-link" data-doc-id="${refDoc.id}" style="color: #3b82f6; text-decoration: underline; cursor: pointer; font-weight: 600;">[Xem VB: ${refDoc.number || refDoc.title}]</span>` : '';
                
                const supplementDiv = document.createElement('div');
                supplementDiv.className = 'supplement-block';
                supplementDiv.style.backgroundColor = 'rgba(16, 185, 129, 0.15)'; // light green
                supplementDiv.style.borderLeft = '4px solid #10b981';
                supplementDiv.style.padding = '0.75rem 1rem';
                supplementDiv.style.margin = '0.5rem 0 1rem 0';
                supplementDiv.style.borderRadius = '4px';
                supplementDiv.style.color = '#1e293b'; // black text
                supplementDiv.style.fontSize = '13px';
                supplementDiv.style.fontFamily = "'Merriweather', serif";
                supplementDiv.style.lineHeight = '1.6';
                supplementDiv.innerHTML = `
                    <strong>[Nội dung bổ sung]:</strong> <span style="${getSupplementalTextStyle(note)}">${formatSupplementalText(note.supplementalText)}</span>
                    ${refDoc ? `<div style="margin-top: 0.25rem; font-size: 11px; color: #555555; font-family: sans-serif; font-style: italic;">Văn bản dẫn chiếu bổ sung: ${refLink}</div>${refEffectiveDateLine(refDoc)}` : ''}
                `;

                // Insert in DOM after targetEl
                targetEl.parentNode.insertBefore(supplementDiv, targetEl.nextSibling);
            }

            // 3. Render Guidance Blocks (specifically for guided notes)
            if (note.noteType === 'guided') {
                const refDoc = state.documents.find(d => d.id === Number(note.refDocId));
                const refLink = refDoc ? `<span class="ref-link" data-doc-id="${refDoc.id}" style="color: #2563eb; text-decoration: underline; cursor: pointer; font-weight: 600;">[Xem VB hướng dẫn: ${refDoc.number || refDoc.title}]</span>` : 'Chưa chọn văn bản hướng dẫn';
                
                const guideDiv = document.createElement('div');
                guideDiv.className = 'supplement-block'; // Will be cleaned up automatically
                guideDiv.style.backgroundColor = 'rgba(59, 130, 246, 0.12)'; // light blue
                guideDiv.style.borderLeft = '4px solid #3b82f6';
                guideDiv.style.padding = '0.75rem 1rem';
                guideDiv.style.margin = '0.5rem 0 1rem 0';
                guideDiv.style.borderRadius = '4px';
                guideDiv.style.color = '#1e293b'; // black text
                guideDiv.style.fontSize = '13px';
                guideDiv.style.fontFamily = "'Merriweather', serif";
                guideDiv.style.lineHeight = '1.6';
                guideDiv.innerHTML = `
                    <strong>[Hướng dẫn thi hành]:</strong> Điều khoản này được hướng dẫn chi tiết bởi văn bản: ${refLink}
                    ${note.noteText ? `<div style="margin-top: 0.25rem; font-size: 12px; color: #4b5563; font-family: sans-serif;"><em>Nội dung hướng dẫn chi tiết:</em> ${note.noteText}</div>` : ''}
                `;

                targetEl.parentNode.insertBefore(guideDiv, targetEl.nextSibling);
            }
        }
    });

    // Highlight note clicks
    parent.querySelectorAll('.highlight-note').forEach(span => {
        span.addEventListener('click', (e) => {
            e.stopPropagation();
            const noteId = span.getAttribute('data-note-id');
            const noteCard = document.querySelector(`.note-item[data-id="${noteId}"]`);
            if (noteCard) {
                noteCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                noteCard.style.border = '1px solid var(--primary-color)';
                setTimeout(() => noteCard.style.border = 'var(--glass-border)', 2000);
            }
        });
    });

    // Click listeners to reference links
    parent.querySelectorAll('.ref-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const docId = link.getAttribute('data-doc-id');
            openDocumentInViewer(docId);
        });
    });
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mirror of the highlight-note click above: jumps from a note card in the
// sidebar to the đoạn văn bản it annotates in the document pane.
function jumpToNoteHighlight(noteId) {
    const target = elements.viewerPaperContent.querySelector(`[data-note-id="${noteId}"]`);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const prevOutline = target.style.outline;
    const prevOutlineOffset = target.style.outlineOffset;
    target.style.outline = '2px solid var(--primary-color)';
    target.style.outlineOffset = '2px';
    setTimeout(() => {
        target.style.outline = prevOutline;
        target.style.outlineOffset = prevOutlineOffset;
    }, 2000);

    // On mobile the notes sidebar is a slide-in overlay covering the
    // document — close it after jumping so the highlighted text is visible.
    if (window.innerWidth <= 768) {
        const notesSidebar = document.getElementById('notes-sidebar');
        const notesHandle = document.getElementById('notes-resize-handle');
        notesSidebar.classList.add('collapsed');
        notesHandle.classList.add('hidden');
        localStorage.setItem('viewerNotesCollapsed', 'true');
        const outlineSidebar = document.getElementById('outline-sidebar');
        const anyOpen = !outlineSidebar.classList.contains('collapsed');
        document.getElementById('mobile-sidebar-backdrop').classList.toggle('active', anyOpen);
    }
}

// Render Notes side pane list. Color/format-only highlights still apply to
// the document text (see applyNotesHighlights) but aren't listed here —
// there's no explanation to review, so they'd just be clutter.
function renderNotesList() {
    elements.viewerNotesList.innerHTML = '';
    const trackableNotes = state.currentNotes.filter(isTrackableNote);

    if (trackableNotes.length === 0) {
        elements.viewerNotesList.innerHTML = `
            <div class="empty-state" style="padding: 2rem 0;">
                <p style="font-size: 0.85rem; color: var(--text-muted);">Bôi đen văn bản ở khung giữa và bấm "Thêm ghi chú".</p>
            </div>
        `;
    } else {
        trackableNotes.forEach(note => {
            const card = document.createElement('div');
            card.className = 'note-item';
            card.setAttribute('data-id', note.id);
            
            let badge = '';
            if (note.noteType === 'amended') {
                badge = '<span class="badge badge-amber" style="margin-bottom: 0.5rem; display: inline-block;">Sửa đổi</span>';
            } else if (note.noteType === 'abolished') {
                badge = '<span class="badge badge-rose" style="margin-bottom: 0.5rem; display: inline-block;">Bãi bỏ</span>';
            } else if (note.noteType === 'supplemented') {
                badge = '<span class="badge badge-green" style="margin-bottom: 0.5rem; display: inline-block;">Bổ sung</span>';
            } else if (note.noteType === 'guided') {
                badge = '<span class="badge badge-blue" style="margin-bottom: 0.5rem; display: inline-block;">Được hướng dẫn</span>';
            }

            card.innerHTML = `
                ${badge}
                <div class="note-quote">"${note.selectedText}"</div>
                ${note.noteType === 'supplemented' ? `
                    <div style="background: rgba(16, 185, 129, 0.1); border-left: 2px solid #10b981; padding: 0.5rem; margin: 0.5rem 0; font-size: 0.8rem; border-radius: 4px; color: var(--text-main);">
                        <strong>Đoạn bổ sung:</strong> <span style="${getSupplementalTextStyle(note)}">${formatSupplementalText(note.supplementalText)}</span>
                    </div>
                ` : ''}
                <div class="note-text">${linkifyText(note.noteText)}</div>
                <div class="note-date">Tạo ngày: ${note.createdAt ? note.createdAt.substring(0, 10) : 'Chưa rõ'}</div>
                <div class="note-actions">
                    <button class="action-btn edit-note-inline" title="Sửa ghi chú"><i data-lucide="pencil" style="width: 14px;"></i></button>
                    <button class="action-btn save-note-inline" title="Lưu thay đổi" style="display: none;"><i data-lucide="check" style="width: 14px; color: var(--success-color);"></i></button>
                    <button class="action-btn delete-note-inline" title="Xóa ghi chú"><i data-lucide="trash-2" style="width: 14px; color: var(--danger-color);"></i></button>
                </div>
            `;

            const noteTextEl = card.querySelector('.note-text');
            const editBtn = card.querySelector('.edit-note-inline');
            const saveBtn = card.querySelector('.save-note-inline');

            // Notes render read-only with clickable links by default; editing
            // (plain text, no links) only starts once the user asks for it,
            // so a normal click on a pasted link opens it instead of just
            // placing a text cursor.
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                noteTextEl.contentEditable = 'true';
                noteTextEl.textContent = note.noteText || '';
                noteTextEl.focus();
                editBtn.style.display = 'none';
                saveBtn.style.display = '';
            });

            saveBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newText = noteTextEl.textContent.trim();
                await db.updateNote(note.id, newText);
                note.noteText = newText;
                alert("Cập nhật ghi chú thành công!");
                openDocumentInViewer(state.currentDoc.id);
            });

            card.querySelector('.delete-note-inline').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm("Xóa ghi chú này?")) {
                    await db.deleteNote(note.id);
                    openDocumentInViewer(state.currentDoc.id);
                }
            });

            // Click anywhere else on the card jumps the document pane to the
            // đoạn văn bản đang được ghi chú — the mirror of clicking a
            // highlight in the document to jump to its note card.
            card.addEventListener('click', (e) => {
                if (e.target.closest('.note-actions') || e.target.closest('a') || noteTextEl.isContentEditable) return;
                jumpToNoteHighlight(note.id);
            });

            elements.viewerNotesList.appendChild(card);
        });
        lucide.createIcons();
    }
}

// Shows, above the notes list, every other document that has a recorded
// relation with the one currently open — so while nghiên cứu a văn bản the
// user can see and jump to its related documents (VB hướng dẫn/sửa đổi/
// bổ sung/bãi bỏ/thay thế) without switching to the Sơ đồ quan hệ tab.
function renderRelatedDocsPanel(docId) {
    const container = document.getElementById('viewer-related-docs');
    if (!container) return;

    const relations = state.relations.filter(r => r.sourceDocId === docId || r.targetDocId === docId);

    if (relations.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';

    // Arrow direction encodes role: → this document acts on the other
    // (nguồn), ← the other acts on this document (đích).
    const itemsHtml = relations.map(rel => {
        const isSource = rel.sourceDocId === docId;
        const otherDocId = isSource ? rel.targetDocId : rel.sourceDocId;
        const otherDoc = state.documents.find(d => d.id === otherDocId);
        const meta = RELATION_META[rel.relationType] || RELATION_META.huong_dan;
        const arrow = isSource ? '→' : '←';
        const otherName = otherDoc ? escapeHtml(otherDoc.number || otherDoc.title) : 'Văn bản đã xóa';
        const tooltip = otherDoc
            ? escapeHtml(`${otherDoc.number ? otherDoc.number + ' - ' : ''}${otherDoc.title}`)
            : 'Văn bản không còn trong hệ thống';
        const noteHtml = rel.note
            ? `<div class="related-doc-note" title="${escapeHtml(rel.note)}">${escapeHtml(rel.note)}</div>`
            : '';
        return `
            <div class="related-doc-item${otherDoc ? '' : ' disabled'}" ${otherDoc ? `data-open-doc="${otherDoc.id}"` : ''} title="${tooltip}">
                <div class="related-doc-item-top">
                    <span class="rel-type-badge" style="background: ${meta.color}22; color: ${meta.color};">${meta.label}</span>
                    <span class="related-doc-arrow" style="color: ${meta.color};">${arrow}</span>
                    <span class="related-doc-name">${otherName}</span>
                </div>
                ${noteHtml}
            </div>`;
    }).join('');

    container.innerHTML = `
        <div class="related-docs-title"><i data-lucide="git-branch" style="width: 14px;"></i> Văn bản liên quan (${relations.length})</div>
        <div class="related-docs-list">${itemsHtml}</div>
    `;

    container.querySelectorAll('[data-open-doc]').forEach(el => {
        el.addEventListener('click', () => openDocumentInViewer(Number(el.getAttribute('data-open-doc'))));
    });
    lucide.createIcons();
}

// Global state formatting variables for active selection
let activeBold = false;
let activeItalic = false;
let activeUnderline = false;
let activeTextColor = 'inherit';
let activeBgColor = 'rgba(253, 224, 71, 0.4)'; // default yellow

// Annotation selection triggers
// Lets the user collapse/expand and drag-resize the outline and notes
// sidebars, freeing up width for reading the document content itself.
// Layout choices persist across reloads via localStorage.
function setupViewerPanelControls() {
    const outlineSidebar = document.getElementById('outline-sidebar');
    const notesSidebar = document.getElementById('notes-sidebar');
    const outlineToggleBtn = document.getElementById('toggle-outline-btn');
    const notesToggleBtn = document.getElementById('toggle-notes-btn');
    const outlineHandle = document.getElementById('outline-resize-handle');
    const notesHandle = document.getElementById('notes-resize-handle');

    const savedOutlineWidth = localStorage.getItem('viewerOutlineWidth');
    const savedNotesWidth = localStorage.getItem('viewerNotesWidth');
    if (savedOutlineWidth) outlineSidebar.style.width = `${savedOutlineWidth}px`;
    if (savedNotesWidth) notesSidebar.style.width = `${savedNotesWidth}px`;

    if (localStorage.getItem('viewerOutlineCollapsed') === 'true') {
        outlineSidebar.classList.add('collapsed');
        outlineHandle.classList.add('hidden');
    }
    if (localStorage.getItem('viewerNotesCollapsed') === 'true') {
        notesSidebar.classList.add('collapsed');
        notesHandle.classList.add('hidden');
    }

    // On mobile the outline/notes panels render as slide-in overlays (see the
    // mobile media query), so show the shared backdrop while either is open;
    // on desktop this class has no visual effect (backdrop stays display:none).
    function syncMobileOverlayBackdrop() {
        const anyOpen = !outlineSidebar.classList.contains('collapsed') || !notesSidebar.classList.contains('collapsed');
        document.getElementById('mobile-sidebar-backdrop').classList.toggle('active', anyOpen);
    }

    outlineToggleBtn.addEventListener('click', () => {
        const collapsed = outlineSidebar.classList.toggle('collapsed');
        outlineHandle.classList.toggle('hidden', collapsed);
        localStorage.setItem('viewerOutlineCollapsed', collapsed);
        syncMobileOverlayBackdrop();
    });

    notesToggleBtn.addEventListener('click', () => {
        const collapsed = notesSidebar.classList.toggle('collapsed');
        notesHandle.classList.toggle('hidden', collapsed);
        localStorage.setItem('viewerNotesCollapsed', collapsed);
        syncMobileOverlayBackdrop();
    });

    setupResizeHandle(outlineHandle, outlineSidebar, 'left', 180, 480, 'viewerOutlineWidth');
    setupResizeHandle(notesHandle, notesSidebar, 'right', 220, 520, 'viewerNotesWidth');
}

// side: which edge of the panel is fixed to the window edge — 'left' means
// the panel sits on the left (dragging the handle right grows it), 'right'
// means it sits on the right (dragging the handle right shrinks it).
function setupResizeHandle(handle, panel, side, minWidth, maxWidth, storageKey) {
    let startX = 0;
    let startWidth = 0;

    function onMouseMove(e) {
        const delta = e.clientX - startX;
        const proposed = side === 'left' ? startWidth + delta : startWidth - delta;
        const clamped = Math.min(maxWidth, Math.max(minWidth, proposed));
        panel.style.width = `${clamped}px`;
    }

    function onMouseUp() {
        handle.classList.remove('dragging');
        panel.classList.remove('resizing');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        localStorage.setItem(storageKey, Math.round(parseFloat(panel.style.width)));
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    }

    handle.addEventListener('mousedown', (e) => {
        if (panel.classList.contains('collapsed')) return;
        e.preventDefault();
        startX = e.clientX;
        startWidth = panel.getBoundingClientRect().width;
        handle.classList.add('dragging');
        panel.classList.add('resizing');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });
}

function setupViewerHandlers() {
    setupViewerPanelControls();

    // Zoom levels
    elements.viewerZoomIn.addEventListener('click', () => {
        state.zoomLevel = Math.min(state.zoomLevel + 10, 150);
        elements.viewerPaperContent.style.fontSize = `${14 * (state.zoomLevel / 100)}px`;
        const splitBody = document.getElementById('viewer-paper-content-split-body');
        if (splitBody) splitBody.style.fontSize = `${14 * (state.zoomLevel / 100)}px`;
    });

    elements.viewerZoomOut.addEventListener('click', () => {
        state.zoomLevel = Math.max(state.zoomLevel - 10, 80);
        elements.viewerPaperContent.style.fontSize = `${14 * (state.zoomLevel / 100)}px`;
        const splitBody = document.getElementById('viewer-paper-content-split-body');
        if (splitBody) splitBody.style.fontSize = `${14 * (state.zoomLevel / 100)}px`;
    });

    // Split screen buttons listeners
    const splitBtn = document.getElementById('viewer-split-btn');
    const splitClose = document.getElementById('close-split-pane-btn');
    
    splitBtn.addEventListener('click', () => {
        state.splitMode = !state.splitMode;
        toggleSplitModeUI();
    });
    
    splitClose.addEventListener('click', () => {
        state.splitMode = false;
        toggleSplitModeUI();
    });

    // Popover legal note type select
    const noteTypeSelect = document.getElementById('popover-note-type');
    const formatToolbar = document.getElementById('popover-formatting-toolbar');
    const supplementFields = document.getElementById('supplement-fields');
    const refDocFields = document.getElementById('ref-doc-fields');
    const refDocLabel = document.getElementById('ref-doc-label');
    
    noteTypeSelect.addEventListener('change', () => {
        const type = noteTypeSelect.value;
        if (type === 'supplemented') {
            supplementFields.style.display = 'flex';
            refDocFields.style.display = 'flex';
            refDocLabel.textContent = "Văn bản bổ sung (dẫn chiếu):";
            // Keep the Bold/Italic/Underline + màu toolbar visible here too, so
            // the anchor text (phần được chọn trong văn bản gốc) can also be
            // highlighted/formatted, not just the "[Nội dung bổ sung]" block.
            formatToolbar.style.display = 'flex';
        } else if (type === 'guided') {
            supplementFields.style.display = 'none';
            refDocFields.style.display = 'flex';
            refDocLabel.textContent = "Văn bản hướng dẫn dẫn chiếu:";
            formatToolbar.style.display = 'none';
        } else if (type === 'normal') {
            supplementFields.style.display = 'none';
            refDocFields.style.display = 'none';
            formatToolbar.style.display = 'flex';
        } else {
            supplementFields.style.display = 'none';
            refDocFields.style.display = 'none';
            formatToolbar.style.display = 'none';
        }
    });

    // Formatting button listeners inside popup
    const formatBold = document.getElementById('format-bold');
    const formatItalic = document.getElementById('format-italic');
    const formatUnderline = document.getElementById('format-underline');
    const textColors = document.querySelectorAll('.note-popover [data-color]');
    const bgColors = document.querySelectorAll('.note-popover [data-bg]');

    formatBold.addEventListener('click', () => {
        activeBold = !activeBold;
        formatBold.classList.toggle('active', activeBold);
    });

    formatItalic.addEventListener('click', () => {
        activeItalic = !activeItalic;
        formatItalic.classList.toggle('active', activeItalic);
    });

    formatUnderline.addEventListener('click', () => {
        activeUnderline = !activeUnderline;
        formatUnderline.classList.toggle('active', activeUnderline);
    });

    // Ctrl+B / Ctrl+I / Ctrl+U as quick keyboard equivalents of the toolbar
    // buttons above, while the annotation popover is open (i.e. right after
    // selecting text to highlight) — lets formatting be applied without
    // reaching for the mouse.
    document.addEventListener('keydown', (e) => {
        if (elements.popover.style.display !== 'flex') return;
        if (!e.ctrlKey && !e.metaKey) return;
        const key = e.key.toLowerCase();
        if (key === 'b') {
            e.preventDefault();
            formatBold.click();
        } else if (key === 'i') {
            e.preventDefault();
            formatItalic.click();
        } else if (key === 'u') {
            e.preventDefault();
            formatUnderline.click();
        }
    });

    textColors.forEach(dot => {
        dot.addEventListener('click', () => {
            textColors.forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            activeTextColor = dot.getAttribute('data-color');
        });
    });

    bgColors.forEach(dot => {
        dot.addEventListener('click', () => {
            bgColors.forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            activeBgColor = dot.getAttribute('data-bg');
        });
    });

    // ===== Enhanced In-doc Text Search =====
    let searchMatches = [];
    let currentMatchIndex = -1;
    let searchDebounceTimer = null;

    const searchCounter = document.getElementById('search-counter');
    const searchClearBtn = document.getElementById('search-clear-btn');
    const searchPrevBtn = document.getElementById('search-prev-btn');
    const searchNextBtn = document.getElementById('search-next-btn');

    function performSearch() {
        const query = elements.viewerSearchInput.value.trim();
        removeSearchHighlights();
        clearOutlineSearchHighlights();
        searchMatches = [];
        currentMatchIndex = -1;

        if (query.length < 2) {
            searchCounter.style.display = 'none';
            searchClearBtn.style.display = 'none';
            return;
        }

        searchClearBtn.style.display = 'block';
        const queryLower = query.toLowerCase();

        // Walk through both main and split panes
        const containers = [elements.viewerPaperContent];
        const splitBody = document.getElementById('viewer-paper-content-split-body');
        if (state.splitMode && splitBody) {
            containers.push(splitBody);
        }

        containers.forEach(container => {
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            let node;
            const nodesToProcess = [];
            
            while (node = walker.nextNode()) {
                const parent = node.parentElement;
                if (parent && parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE' && !parent.classList.contains('highlight-search') && node.nodeValue.toLowerCase().includes(queryLower)) {
                    nodesToProcess.push(node);
                }
            }

            nodesToProcess.forEach(node => {
                const text = node.nodeValue;
                const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
                const parts = text.split(regex);

                if (parts.length <= 1) return;

                const fragment = document.createDocumentFragment();
                parts.forEach(part => {
                    if (regex.test(part) || part.toLowerCase() === queryLower) {
                        const span = document.createElement('span');
                        span.className = 'highlight-search';
                        span.textContent = part;
                        fragment.appendChild(span);
                        searchMatches.push(span);
                    } else {
                        fragment.appendChild(document.createTextNode(part));
                    }
                });

                node.parentNode.replaceChild(fragment, node);
            });
        });

        // Update counter
        if (searchMatches.length > 0) {
            currentMatchIndex = 0;
            highlightOutlineSections();
            highlightActiveMatch();
            searchCounter.textContent = `1/${searchMatches.length}`;
            searchCounter.style.display = 'inline';
        } else {
            searchCounter.textContent = '0/0';
            searchCounter.style.display = 'inline';
            searchCounter.style.color = '#ef4444';
            setTimeout(() => { searchCounter.style.color = 'var(--text-muted)'; }, 1500);
        }
    }

    // === Outline integration: find which heading section a match element belongs to ===
    function findOwnerHeadingId(matchEl) {
        // Walk backwards through previous sibling elements and ancestors to find the nearest heading-node-*
        let el = matchEl;
        while (el) {
            // Check current element and its preceding siblings
            let sibling = el;
            while (sibling) {
                if (sibling.nodeType === 1) {
                    // Check if this element IS a heading
                    if (sibling.id && sibling.id.startsWith('heading-node-')) {
                        return sibling.id;
                    }
                    // Check if any heading is the last heading inside this element (for complex nesting)
                    const headingsInside = sibling.querySelectorAll('[id^="heading-node-"]');
                    if (headingsInside.length > 0) {
                        return headingsInside[headingsInside.length - 1].id;
                    }
                }
                sibling = sibling.previousSibling;
            }
            el = el.parentElement;
        }
        return null;
    }

    function highlightOutlineSections() {
        clearOutlineSearchHighlights();
        if (searchMatches.length === 0) return;

        // Count matches per heading section
        const sectionMatchCounts = {};
        searchMatches.forEach(matchEl => {
            const headingId = findOwnerHeadingId(matchEl);
            if (headingId) {
                sectionMatchCounts[headingId] = (sectionMatchCounts[headingId] || 0) + 1;
            }
        });

        // Find and highlight corresponding outline items
        const outlineItems = elements.viewerOutline.querySelectorAll('.outline-item');
        outlineItems.forEach(li => {
            // Extract the heading ID this outline item links to
            const headingId = li.getAttribute('data-heading-id');
            if (headingId && sectionMatchCounts[headingId]) {
                li.classList.add('has-search-match');
                // Add match count badge
                let badge = li.querySelector('.outline-match-count');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'outline-match-count';
                    li.appendChild(badge);
                }
                badge.textContent = sectionMatchCounts[headingId];
            }
        });
    }

    function highlightActiveOutlineSection() {
        // Remove all active-search-section from outline items
        const outlineItems = elements.viewerOutline.querySelectorAll('.outline-item');
        outlineItems.forEach(li => li.classList.remove('active-search-section'));

        if (currentMatchIndex < 0 || currentMatchIndex >= searchMatches.length) return;

        const activeEl = searchMatches[currentMatchIndex];
        const headingId = findOwnerHeadingId(activeEl);
        if (!headingId) return;

        outlineItems.forEach(li => {
            if (li.getAttribute('data-heading-id') === headingId) {
                li.classList.add('active-search-section');
                // Scroll the outline item into view if needed
                const outlineContainer = li.closest('.outline-list') || li.parentElement;
                if (outlineContainer) {
                    const liRect = li.getBoundingClientRect();
                    const contRect = outlineContainer.getBoundingClientRect();
                    if (liRect.top < contRect.top || liRect.bottom > contRect.bottom) {
                        li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }
            }
        });
    }

    function clearOutlineSearchHighlights() {
        const outlineItems = elements.viewerOutline.querySelectorAll('.outline-item');
        outlineItems.forEach(li => {
            li.classList.remove('has-search-match', 'active-search-section');
            const badge = li.querySelector('.outline-match-count');
            if (badge) badge.remove();
        });
    }

    function highlightActiveMatch() {
        // Remove old active
        searchMatches.forEach(el => el.classList.remove('active-match'));

        if (currentMatchIndex >= 0 && currentMatchIndex < searchMatches.length) {
            const activeEl = searchMatches[currentMatchIndex];
            activeEl.classList.add('active-match');

            // Scroll into view within the nearest scrollable column
            const column = activeEl.closest('.viewer-column') || activeEl.closest('.document-scroller');
            if (column) {
                const elRect = activeEl.getBoundingClientRect();
                const colRect = column.getBoundingClientRect();
                
                if (elRect.top < colRect.top || elRect.bottom > colRect.bottom) {
                    activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            } else {
                activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            searchCounter.textContent = `${currentMatchIndex + 1}/${searchMatches.length}`;

            // Highlight the active section in outline
            highlightActiveOutlineSection();
        }
    }

    function goToNextMatch() {
        if (searchMatches.length === 0) return;
        currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
        highlightActiveMatch();
    }

    function goToPrevMatch() {
        if (searchMatches.length === 0) return;
        currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
        highlightActiveMatch();
    }

    function clearSearch() {
        elements.viewerSearchInput.value = '';
        removeSearchHighlights();
        clearOutlineSearchHighlights();
        searchMatches = [];
        currentMatchIndex = -1;
        searchCounter.style.display = 'none';
        searchClearBtn.style.display = 'none';
        elements.viewerSearchInput.focus();
    }

    // Debounced search on input
    elements.viewerSearchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(performSearch, 300);
    });

    // Keyboard shortcuts
    elements.viewerSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
                goToPrevMatch();
            } else {
                goToNextMatch();
            }
        } else if (e.key === 'Escape') {
            clearSearch();
        }
    });

    searchNextBtn.addEventListener('click', goToNextMatch);
    searchPrevBtn.addEventListener('click', goToPrevMatch);
    searchClearBtn.addEventListener('click', clearSearch);

    function removeSearchHighlights() {
        const containers = [elements.viewerPaperContent];
        const splitBody = document.getElementById('viewer-paper-content-split-body');
        if (splitBody) containers.push(splitBody);

        containers.forEach(container => {
            const highlights = container.querySelectorAll('.highlight-search');
            highlights.forEach(hl => {
                const parent = hl.parentNode;
                const textNode = document.createTextNode(hl.textContent);
                parent.replaceChild(textNode, hl);
                parent.normalize();
            });
        });
    }

    elements.viewerPaperContent.addEventListener('mouseup', handleTextSelection);
    elements.viewerPaperContent.addEventListener('touchend', handleTextSelection);

    // Also handle text selections on the split pane body
    const splitBody = document.getElementById('viewer-paper-content-split-body');
    if (splitBody) {
        splitBody.addEventListener('mouseup', handleTextSelection);
        splitBody.addEventListener('touchend', handleTextSelection);
    }

    elements.popoverCloseBtn.addEventListener('click', () => {
        elements.popover.style.display = 'none';
        window.getSelection().removeAllRanges();
    });

    elements.popoverSaveBtn.addEventListener('click', async () => {
        const noteType = noteTypeSelect.value;
        const supplementalText = document.getElementById('popover-supplemental-text').value.trim();
        const refDocId = document.getElementById('popover-ref-doc').value;
        const noteText = elements.popoverNoteText.value.trim();
        
        if (activeSelection) {
            const noteData = {
                docId: activeSelection.docId, // Dynamic document ID
                paragraphIndex: activeSelection.paragraphIndex,
                selectedText: activeSelection.selectedText,
                noteText: noteText,
                noteType: noteType,
                supplementalText: supplementalText,
                refDocId: refDocId || null,
                highlightColor: activeBgColor,
                textColor: activeTextColor,
                isBold: activeBold,
                isItalic: activeItalic,
                isUnderline: activeUnderline || (noteType === 'abolished')
            };

            await db.addNote(noteData);
            elements.popover.style.display = 'none';
            elements.popoverNoteText.value = '';
            document.getElementById('popover-supplemental-text').value = '';
            
            await openDocumentInViewer(state.currentDoc.id);
            if (state.splitMode && state.splitDoc) {
                await loadSplitDocument(state.splitDoc.id);
            }
        }
    });
}

function handleTextSelection(e) {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    if (selectedText.length > 2) {
        const range = selection.getRangeAt(0);
        
        let container = range.startContainer;
        let isSplit = false;
        
        const splitBody = document.getElementById('viewer-paper-content-split-body');
        
        while (container && container !== elements.viewerPaperContent && container !== splitBody && !container.hasAttribute?.('data-p-index') && !container.hasAttribute?.('data-p-index-split')) {
            container = container.parentNode;
        }

        if (container) {
            let paragraphIndex = -1;
            let docId = state.currentDoc ? state.currentDoc.id : null;
            
            if (container.hasAttribute?.('data-p-index')) {
                paragraphIndex = Number(container.getAttribute('data-p-index'));
            } else if (container.hasAttribute?.('data-p-index-split')) {
                paragraphIndex = Number(container.getAttribute('data-p-index-split'));
                isSplit = true;
                docId = state.splitDoc ? state.splitDoc.id : null;
            }

            if (paragraphIndex !== -1 && docId !== null) {
                activeSelection = {
                    selectedText: selectedText,
                    paragraphIndex: paragraphIndex,
                    docId: docId,
                    isSplit: isSplit
                };

                // Reset selection formatting defaults & inputs
                activeBold = false;
                activeItalic = false;
                activeUnderline = false;
                activeTextColor = 'inherit';
                activeBgColor = 'rgba(253, 224, 71, 0.4)'; 

                const noteTypeSelect = document.getElementById('popover-note-type');
                noteTypeSelect.value = 'normal';
                document.getElementById('popover-formatting-toolbar').style.display = 'flex';
                document.getElementById('supplement-fields').style.display = 'none';
                document.getElementById('ref-doc-fields').style.display = 'none';
                document.getElementById('popover-supplemental-text').value = '';

                document.getElementById('format-bold').classList.remove('active');
                document.getElementById('format-italic').classList.remove('active');
                document.getElementById('format-underline').classList.remove('active');

                document.querySelectorAll('.note-popover [data-color]').forEach(d => d.classList.remove('active'));
                document.querySelector('.note-popover [data-color="inherit"]').classList.add('active');

                document.querySelectorAll('.note-popover [data-bg]').forEach(d => d.classList.remove('active'));
                document.querySelector('.note-popover [data-bg="rgba(253, 224, 71, 0.4)"]').classList.add('active');

                // Populate reference doc dropdown dynamically
                const refDocSelect = document.getElementById('popover-ref-doc');
                refDocSelect.innerHTML = '<option value="">-- Chọn văn bản dẫn chiếu --</option>';
                sortDocsByIssueDate(state.documents).forEach(doc => {
                    if (doc.id !== docId) {
                        const opt = document.createElement('option');
                        opt.value = doc.id;
                        opt.textContent = `${doc.number ? doc.number + ' - ' : ''}${doc.title}`;
                        refDocSelect.appendChild(opt);
                    }
                });

                elements.popoverPreview.textContent = selectedText.substring(0, 30) + (selectedText.length > 30 ? '...' : '');
                
                const rect = range.getBoundingClientRect();
                elements.popover.style.display = 'flex';

                // Clamp so the popover always stays fully on-screen — on a
                // narrow phone a selection near an edge would otherwise push
                // it off the visible viewport.
                const margin = 8;
                const popoverWidth = elements.popover.offsetWidth;
                const popoverHeight = elements.popover.offsetHeight;
                let left = rect.left + window.scrollX;
                left = Math.min(left, window.scrollX + window.innerWidth - popoverWidth - margin);
                left = Math.max(left, window.scrollX + margin);

                let top = rect.top + window.scrollY - popoverHeight - 10;
                if (top < window.scrollY + margin) {
                    top = rect.bottom + window.scrollY + 10; // not enough room above — show below instead
                }

                elements.popover.style.left = `${left}px`;
                elements.popover.style.top = `${top}px`;
            }
        }
    } else {
        if (!elements.popover.contains(e.target)) {
            elements.popover.style.display = 'none';
        }
    }
}

// Split Screen helpers
function toggleSplitModeUI() {
    const layout = document.querySelector('.viewer-layout');
    const splitPane = document.getElementById('viewer-column-split');
    const splitBtn = document.getElementById('viewer-split-btn');
    
    if (state.splitMode) {
        layout.classList.add('split-active');
        splitPane.style.display = 'flex';
        splitBtn.classList.add('active');
        splitBtn.innerHTML = `<i data-lucide="x" style="width: 16px;"></i> Đóng song song`;
        populateSplitSelect();
    } else {
        layout.classList.remove('split-active');
        splitPane.style.display = 'none';
        splitBtn.classList.remove('active');
        splitBtn.innerHTML = `<i data-lucide="columns-2" style="width: 16px;"></i> Đọc song song`;
        state.splitDoc = null;
    }
    lucide.createIcons();
}

// Searchable picker for the split-view "second document" — type to filter
// by số hiệu/tên, navigate with arrow keys, Enter to pick.
function populateSplitSelect() {
    const input = document.getElementById('viewer-split-search-input');
    const dropdown = document.getElementById('viewer-split-search-dropdown');
    let activeIndex = -1;
    let currentMatches = [];

    const docLabel = (doc) => `${doc.number ? doc.number + ' - ' : ''}${doc.title}`;
    const availableDocs = () => sortDocsByIssueDate(state.documents.filter(d => !state.currentDoc || d.id !== state.currentDoc.id));

    function closeDropdown() {
        dropdown.style.display = 'none';
        activeIndex = -1;
    }

    function highlightActive() {
        dropdown.querySelectorAll('.doc-search-item').forEach((el, i) => {
            el.classList.toggle('active', i === activeIndex);
        });
        const activeEl = dropdown.querySelector('.doc-search-item.active');
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
    }

    function selectDoc(doc) {
        input.value = docLabel(doc);
        closeDropdown();
        loadSplitDocument(doc.id);
    }

    function renderDropdown() {
        const q = input.value.trim().toLowerCase();
        currentMatches = availableDocs().filter(d => !q || docLabel(d).toLowerCase().includes(q));
        activeIndex = -1;

        if (currentMatches.length === 0) {
            dropdown.innerHTML = '<div class="doc-search-empty">Không tìm thấy văn bản phù hợp</div>';
        } else {
            dropdown.innerHTML = currentMatches.map((d, i) => `
                <div class="doc-search-item" data-index="${i}">
                    <span class="doc-search-item-number">${escapeHtml(d.number || d.docType)}</span>
                    <span class="doc-search-item-title">${escapeHtml(d.title)}</span>
                </div>
            `).join('');
            dropdown.querySelectorAll('.doc-search-item').forEach((item, i) => {
                // mousedown (not click) fires before the input's blur hides the dropdown
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    selectDoc(currentMatches[i]);
                });
            });
        }
        dropdown.style.display = 'block';
    }

    // Reset visible selection each time (matches the prior <select> behavior),
    // but keep the current split doc's label showing if it's still valid.
    input.value = state.splitDoc && availableDocs().some(d => d.id === state.splitDoc.id)
        ? docLabel(state.splitDoc)
        : '';
    closeDropdown();
    dropdown.innerHTML = '';

    input.oninput = renderDropdown;
    input.onfocus = renderDropdown;
    input.onblur = () => setTimeout(closeDropdown, 150);

    input.onkeydown = (e) => {
        if (dropdown.style.display === 'none') return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = Math.min(activeIndex + 1, currentMatches.length - 1);
            highlightActive();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            highlightActive();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIndex >= 0 && currentMatches[activeIndex]) {
                selectDoc(currentMatches[activeIndex]);
            }
        } else if (e.key === 'Escape') {
            closeDropdown();
            input.blur();
        }
    };
}

async function loadSplitDocument(id) {
    const doc = await db.getDocument(id);
    if (!doc) return;

    state.splitDoc = doc;
    const body = document.getElementById('viewer-paper-content-split-body');
    
    // Clear and set body font size
    body.style.fontSize = `${14 * (state.zoomLevel / 100)}px`;

    // Parse html content
    const parser = new DOMParser();
    const docDOM = parser.parseFromString(doc.parsedHtml, 'text/html');
    const elList = docDOM.querySelectorAll('h1, h2, h3, h4, h5, h6, p');
    elList.forEach((el, idx) => {
        el.setAttribute('data-p-index-split', idx);
        
        // Auto format detected headings
        const text = el.textContent.trim();
        const isHeading = el.tagName.startsWith('H');
        const isLegalSection = /^(Chương|Mục|Điều|Phần)\s+[0-9a-zA-Z]+/i.test(text);
        if (isHeading || isLegalSection) {
            el.classList.add('detected-heading');
        }
    });

    body.innerHTML = docDOM.body.innerHTML;

    // Apply inline notes highlights inside split pane
    const splitNotes = await db.getNotesForDoc(id);
    body.querySelectorAll('.supplement-block-split').forEach(el => el.remove());

    splitNotes.forEach(note => {
        const targetEl = body.querySelector(`[data-p-index-split="${note.paragraphIndex}"]`);
        if (targetEl) {
            const textContent = targetEl.textContent;
            if (textContent.includes(note.selectedText)) {
                const selectionEscaped = escapeRegExp(note.selectedText);
                const regex = new RegExp(`(${selectionEscaped})`, 'g');

                let styles = '';
                if (note.noteType === 'amended') {
                    styles += 'background-color: rgba(253, 224, 71, 0.9); color: #ef4444; ';
                } else if (note.noteType === 'abolished') {
                    styles += 'background-color: rgba(253, 224, 71, 0.9); color: #ef4444; text-decoration: underline; ';
                } else if (note.noteType === 'guided') {
                    styles += 'background-color: rgba(96, 165, 250, 0.35); color: #1e293b; ';
                } else {
                    if (note.highlightColor) styles += `background-color: ${note.highlightColor}; `;
                    if (note.textColor && note.textColor !== 'inherit') styles += `color: ${note.textColor}; `;
                    if (note.isBold) styles += `font-weight: bold; `;
                    if (note.isItalic) styles += `font-style: italic; `;
                    if (note.isUnderline) styles += `text-decoration: underline; `;
                }
                const titleAttr = note.noteText ? `title="${note.noteText.replace(/"/g, '&quot;')}"` : '';
                targetEl.innerHTML = targetEl.innerHTML.replace(regex, `<span class="highlight-note" data-note-id="${note.id}" style="${styles}" ${titleAttr}>$1</span>`);
            } else {
                targetEl.classList.add('highlight-note');
                targetEl.setAttribute('data-note-id', note.id);
                if (note.noteType === 'amended') {
                    targetEl.style.backgroundColor = 'rgba(253, 224, 71, 0.9)';
                    targetEl.style.color = '#ef4444';
                } else if (note.noteType === 'abolished') {
                    targetEl.style.backgroundColor = 'rgba(253, 224, 71, 0.9)';
                    targetEl.style.color = '#ef4444';
                    targetEl.style.textDecoration = 'underline';
                } else if (note.noteType === 'guided') {
                    targetEl.style.backgroundColor = 'rgba(96, 165, 250, 0.35)';
                    targetEl.style.color = '#1e293b';
                } else {
                    if (note.highlightColor) targetEl.style.backgroundColor = note.highlightColor;
                    if (note.textColor && note.textColor !== 'inherit') targetEl.style.color = note.textColor;
                    if (note.isBold) targetEl.style.fontWeight = 'bold';
                    if (note.isItalic) targetEl.style.fontStyle = 'italic';
                    if (note.isUnderline) targetEl.style.textDecoration = 'underline';
                }
            }

            // Render supplemental block inside split doc
            if (note.noteType === 'supplemented') {
                const refDoc = state.documents.find(d => d.id === Number(note.refDocId));
                const refLink = refDoc ? `<span class="ref-link" data-doc-id="${refDoc.id}" style="color: #3b82f6; text-decoration: underline; cursor: pointer; font-weight: 600;">[Xem VB: ${refDoc.number || refDoc.title}]</span>` : '';
                const supplementDiv = document.createElement('div');
                supplementDiv.className = 'supplement-block-split';
                supplementDiv.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
                supplementDiv.style.borderLeft = '4px solid #10b981';
                supplementDiv.style.padding = '0.75rem 1rem';
                supplementDiv.style.margin = '0.5rem 0 1rem 0';
                supplementDiv.style.borderRadius = '4px';
                supplementDiv.style.color = '#1e293b';
                supplementDiv.style.fontSize = '13px';
                supplementDiv.style.fontFamily = "'Merriweather', serif";
                supplementDiv.style.lineHeight = '1.6';
                supplementDiv.innerHTML = `
                    <strong>[Nội dung bổ sung]:</strong> <span style="${getSupplementalTextStyle(note)}">${formatSupplementalText(note.supplementalText)}</span>
                    ${refDoc ? `<div style="margin-top: 0.25rem; font-size: 11px; color: #555555; font-family: sans-serif; font-style: italic;">Văn bản dẫn chiếu bổ sung: ${refLink}</div>${refEffectiveDateLine(refDoc)}` : ''}
                `;
                targetEl.parentNode.insertBefore(supplementDiv, targetEl.nextSibling);
            }

            // Render guidance block inside split doc
            if (note.noteType === 'guided') {
                const refDoc = state.documents.find(d => d.id === Number(note.refDocId));
                const refLink = refDoc ? `<span class="ref-link" data-doc-id="${refDoc.id}" style="color: #2563eb; text-decoration: underline; cursor: pointer; font-weight: 600;">[Xem VB hướng dẫn: ${refDoc.number || refDoc.title}]</span>` : 'Chưa chọn văn bản hướng dẫn';
                const guideDiv = document.createElement('div');
                guideDiv.className = 'supplement-block-split';
                guideDiv.style.backgroundColor = 'rgba(59, 130, 246, 0.12)';
                guideDiv.style.borderLeft = '4px solid #3b82f6';
                guideDiv.style.padding = '0.75rem 1rem';
                guideDiv.style.margin = '0.5rem 0 1rem 0';
                guideDiv.style.borderRadius = '4px';
                guideDiv.style.color = '#1e293b';
                guideDiv.style.fontSize = '13px';
                guideDiv.style.fontFamily = "'Merriweather', serif";
                guideDiv.style.lineHeight = '1.6';
                guideDiv.innerHTML = `
                    <strong>[Hướng dẫn thi hành]:</strong> Điều khoản này được hướng dẫn chi tiết bởi văn bản: ${refLink}
                    ${note.noteText ? `<div style="margin-top: 0.25rem; font-size: 12px; color: #4b5563; font-family: sans-serif;"><em>Nội dung hướng dẫn chi tiết:</em> ${note.noteText}</div>` : ''}
                `;
                targetEl.parentNode.insertBefore(guideDiv, targetEl.nextSibling);
            }
        }
    });

    // Handle clicks
    body.querySelectorAll('.highlight-note').forEach(span => {
        span.addEventListener('click', (e) => {
            e.stopPropagation();
            const noteId = span.getAttribute('data-note-id');
            const noteCard = document.querySelector(`.note-item[data-id="${noteId}"]`);
            if (noteCard) {
                noteCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                noteCard.style.border = '1px solid var(--primary-color)';
                setTimeout(() => noteCard.style.border = 'var(--glass-border)', 2000);
            }
        });
    });

    body.querySelectorAll('.ref-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const docId = link.getAttribute('data-doc-id');
            openDocumentInViewer(docId);
        });
    });
}

// --- Comparison Module Handlers ---
function populateCompareDropdowns() {
    const selectA = elements.compareSelectA;
    const selectB = elements.compareSelectB;

    const valA = selectA.value;
    const valB = selectB.value;

    selectA.innerHTML = '<option value="">-- Chọn văn bản thứ nhất --</option>';
    selectB.innerHTML = '<option value="">-- Chọn văn bản thứ hai --</option>';

    sortDocsByIssueDate(state.documents).forEach(doc => {
        const optText = `${doc.number ? doc.number + ' - ' : ''}${doc.title}`;

        const optA = document.createElement('option');
        optA.value = doc.id;
        optA.textContent = optText;
        selectA.appendChild(optA);

        const optB = document.createElement('option');
        optB.value = doc.id;
        optB.textContent = optText;
        selectB.appendChild(optB);
    });

    if (valA && state.documents.some(d => d.id === Number(valA))) selectA.value = valA;
    if (valB && state.documents.some(d => d.id === Number(valB))) selectB.value = valB;
}

// --- Snippet Compare (paste an old + new paragraph, diff word-by-word) ---
// Amended documents rarely line up structurally with the new one (renumbered
// articles, inserted chapters...), so whole-document diffing is unreliable.
// This lets the user paste just the two specific passages they're actually
// comparing while reading side-by-side.
function setupSnippetCompare() {
    const overlay = document.getElementById('snippet-compare-modal-overlay');
    const openBtn = document.getElementById('open-snippet-compare-btn');
    const closeBtn = document.getElementById('snippet-compare-close');
    const runBtn = document.getElementById('snippet-compare-run-btn');
    const oldTextEl = document.getElementById('snippet-old-text');
    const newTextEl = document.getElementById('snippet-new-text');
    const resultWrap = document.getElementById('snippet-compare-result');
    const resultBody = document.getElementById('snippet-compare-result-body');

    function closeModal() {
        overlay.style.display = 'none';
    }

    openBtn.addEventListener('click', () => {
        overlay.style.display = 'flex';
    });
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    runBtn.addEventListener('click', () => {
        const oldText = oldTextEl.value.trim();
        const newText = newTextEl.value.trim();

        if (!oldText || !newText) {
            alert("Vui lòng dán cả đoạn văn bản cũ và đoạn văn bản mới để so sánh!");
            return;
        }

        const diff = Diff.diffWords(oldText, newText);
        let html = '';
        diff.forEach(part => {
            const escapedValue = escapeHtml(part.value);
            if (part.added) {
                html += `<ins title="Được bổ sung">${escapedValue}</ins>`;
            } else if (part.removed) {
                html += `<del title="Đã bị lược bỏ">${escapedValue}</del>`;
            } else {
                html += `<span>${escapedValue}</span>`;
            }
        });

        resultBody.innerHTML = html;
        resultWrap.style.display = 'block';
    });
}

function setupCompareHandlers() {
    elements.compareRunBtn.addEventListener('click', async () => {
        const idA = elements.compareSelectA.value;
        const idB = elements.compareSelectB.value;

        if (!idA || !idB) {
            alert("Vui lòng lựa chọn đầy đủ cả 2 văn bản để đối soát!");
            return;
        }

        if (idA === idB) {
            alert("Không thể đối soát 2 văn bản giống hệt nhau!");
            return;
        }

        const docA = await db.getDocument(idA);
        const docB = await db.getDocument(idB);

        if (!docA || !docB) {
            alert("Đã xảy ra lỗi khi tải tài liệu để đối soát.");
            return;
        }

        elements.comparePaneATitle.textContent = `Văn bản A (Gốc): ${docA.number || docA.title}`;
        elements.comparePaneBTitle.textContent = `Văn bản B (Thay thế): ${docB.number || docB.title}`;

        const textA = stripHtml(docA.parsedHtml);
        const textB = stripHtml(docB.parsedHtml);

        // Perform Diffing
        const diff = Diff.diffWords(textA, textB);

        // Render Doc A
        elements.comparePaneABody.innerHTML = `
            <div style="font-family: 'Merriweather', serif; font-size: 13px; line-height: 1.6; white-space: pre-line;">
                ${textA}
            </div>
        `;

        // Render Diff inside Pane B
        let diffHtml = '<div style="font-family: \'Merriweather\', serif; font-size: 13px; line-height: 1.6; white-space: pre-line;">';
        diff.forEach(part => {
            const escapedValue = escapeHtml(part.value);
            if (part.added) {
                diffHtml += `<ins title="Được bổ sung">${escapedValue}</ins>`;
            } else if (part.removed) {
                diffHtml += `<del title="Đã bị lược bỏ">${escapedValue}</del>`;
            } else {
                diffHtml += `<span>${escapedValue}</span>`;
            }
        });
        diffHtml += '</div>';

        elements.comparePaneBBody.innerHTML = diffHtml;
    });
}

function stripHtml(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    tempDiv.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, tr').forEach(el => {
        el.appendChild(document.createTextNode('\n\n'));
    });
    return tempDiv.textContent.trim().replace(/\n{3,}/g, '\n\n');
}

// Bold/Italic/Underline/màu chữ chọn trong popover áp dụng cho phần văn bản
// gốc được bôi đen; dùng lại đúng các cờ đó để style luôn nội dung đoạn bổ
// sung hiển thị (khối xanh lá), theo yêu cầu định dạng đồng bộ cả hai phần.
function getSupplementalTextStyle(note) {
    let s = '';
    if (note.isBold) s += 'font-weight: bold; ';
    if (note.isItalic) s += 'font-style: italic; ';
    if (note.isUnderline) s += 'text-decoration: underline; ';
    if (note.textColor && note.textColor !== 'inherit') s += `color: ${note.textColor}; `;
    return s;
}

// Dòng chữ đỏ "Hiệu lực từ ngày ..." cho khối bổ sung, lấy ngày hiệu lực của
// văn bản bổ sung được dẫn chiếu (refDoc). Nếu chưa nhập ngày hiệu lực thì
// hiển thị nhắc nhở để người dùng bổ sung.
function refEffectiveDateLine(refDoc) {
    if (!refDoc) return '';
    const eff = (refDoc.effectiveDate || '').trim();
    const text = eff ? `Hiệu lực từ ngày ${eff}` : 'Hiệu lực từ ngày: (chưa cập nhật ngày hiệu lực của văn bản bổ sung)';
    return `<div style="margin-top: 0.15rem; font-size: 11px; color: #ef4444; font-family: sans-serif; font-weight: 700;">${text}</div>`;
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Escapes text then turns any http(s) URL into a clickable link. Used for
// read-only note rendering so a pasted link can be clicked directly.
function linkifyText(text) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
        // Trim trailing punctuation that's likely sentence punctuation, not part of the URL
        const trailingMatch = url.match(/[).,;:!?]+$/);
        const trailing = trailingMatch ? trailingMatch[0] : '';
        const cleanUrl = trailing ? url.slice(0, -trailing.length) : url;
        if (!cleanUrl) return url;
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="note-link">${cleanUrl}</a>${trailing}`;
    });
}

// Renders the "đoạn văn bản bổ sung" content: escapes HTML + linkifies URLs
// (via linkifyText) AND preserves the pasted paragraphs/line breaks, so text
// copied from Word/web keeps its xuống dòng thay vì bị dồn thành một khối.
// Blank line (đoạn) => spacing; single newline => line break.
function formatSupplementalText(text) {
    if (!text) return '';
    return linkifyText(text)
        .replace(/(\r\n|\r|\n){2,}/g, '<br><br>')
        .replace(/\r\n|\r|\n/g, '<br>');
}

// Converts plain pasted text into the same one-<p>-per-line shape mammoth
// produces from a .docx, so outline detection, notes, and search all work
// on pasted content exactly like they do on uploaded Word files.
function convertPlainTextToHtml(text) {
    return text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => `<p>${escapeHtml(line)}</p>`)
        .join('');
}

// --- Relations Map Module ---
const RELATION_META = {
    huong_dan: { label: 'Hướng dẫn', color: '#3b82f6', dashed: false, width: 2, directionLabel: 'hướng dẫn cho' },
    sua_doi: { label: 'Sửa đổi', color: '#f59e0b', dashed: true, width: 2, directionLabel: 'sửa đổi' },
    bo_sung: { label: 'Bổ sung', color: '#10b981', dashed: false, width: 2, directionLabel: 'bổ sung cho' },
    bai_bo: { label: 'Bãi bỏ', color: '#ef4444', dashed: true, width: 2, directionLabel: 'bãi bỏ' },
    thay_the: { label: 'Thay thế', color: '#8b5cf6', dashed: false, width: 3, directionLabel: 'thay thế cho' }
};

const DOC_TYPE_COLORS = {
    'Luật': '#3b82f6',
    'Nghị định': '#10b981',
    'Thông tư': '#f59e0b',
    'Công văn': '#8b5cf6',
    'Quyết định': '#ef4444',
    'Khác': '#6b7280'
};
const DOC_TYPE_ORDER = ['Luật', 'Nghị định', 'Thông tư', 'Công văn', 'Quyết định', 'Khác'];

let relZoom = 1;
let relPanX = 0;
let relPanY = 0;
let relIsDragging = false;
let relDragStartX = 0;
let relDragStartY = 0;
let relPanStartX = 0;
let relPanStartY = 0;
let relSelectedDocId = null;

function setupRelationsHandlers() {
    const addBtn = document.getElementById('rel-add-btn');
    const modalOverlay = document.getElementById('rel-modal-overlay');
    const modalClose = document.getElementById('rel-modal-close');
    const sourceSelect = document.getElementById('rel-source-doc');
    const targetSelect = document.getElementById('rel-target-doc');
    const typeSelect = document.getElementById('rel-type-select');
    const directionLabel = document.getElementById('rel-direction-label');
    const noteInput = document.getElementById('rel-note-input');
    const saveBtn = document.getElementById('rel-save-btn');

    const filterType = document.getElementById('rel-filter-type');
    const filterDoc = document.getElementById('rel-filter-doc');
    const filterField = document.getElementById('rel-filter-field');

    const zoomInBtn = document.getElementById('rel-zoom-in');
    const zoomOutBtn = document.getElementById('rel-zoom-out');
    const resetViewBtn = document.getElementById('rel-reset-view');
    const detailClose = document.getElementById('rel-detail-close');
    const canvas = document.getElementById('relations-canvas');

    function openModal() {
        populateRelationDocSelects();
        sourceSelect.value = '';
        targetSelect.value = '';
        typeSelect.value = 'huong_dan';
        noteInput.value = '';
        directionLabel.textContent = RELATION_META[typeSelect.value].directionLabel;
        modalOverlay.style.display = 'flex';
    }

    function closeModal() {
        modalOverlay.style.display = 'none';
    }

    addBtn.addEventListener('click', openModal);
    modalClose.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    typeSelect.addEventListener('change', () => {
        directionLabel.textContent = RELATION_META[typeSelect.value].directionLabel;
    });

    saveBtn.addEventListener('click', async () => {
        const sourceDocId = sourceSelect.value;
        const targetDocId = targetSelect.value;
        const relationType = typeSelect.value;

        if (!sourceDocId || !targetDocId) {
            alert("Vui lòng chọn đầy đủ văn bản nguồn và văn bản đích!");
            return;
        }
        if (sourceDocId === targetDocId) {
            alert("Văn bản nguồn và văn bản đích không được trùng nhau!");
            return;
        }

        await db.addRelation({
            sourceDocId: sourceDocId,
            targetDocId: targetDocId,
            relationType: relationType,
            note: noteInput.value.trim()
        });

        closeModal();
        await loadRelationsPage();
    });

    filterType.addEventListener('change', renderRelationsDiagram);
    filterDoc.addEventListener('change', renderRelationsDiagram);
    if (filterField) {
        filterField.addEventListener('change', renderRelationsDiagram);
    }

    zoomInBtn.addEventListener('click', () => {
        relZoom = Math.min(relZoom + 0.15, 2.5);
        applyRelationsTransform();
    });
    zoomOutBtn.addEventListener('click', () => {
        relZoom = Math.max(relZoom - 0.15, 0.3);
        applyRelationsTransform();
    });
    resetViewBtn.addEventListener('click', () => {
        renderRelationsDiagram();
    });

    detailClose.addEventListener('click', () => {
        relSelectedDocId = null;
        document.querySelectorAll('.rel-node-group').forEach(g => g.classList.remove('selected'));
        resetRelationDetailPanel();
    });

    // Pan handlers (drag empty canvas area)
    canvas.addEventListener('mousedown', (e) => {
        if (e.target.closest('.rel-node-group')) return;
        relIsDragging = true;
        relDragStartX = e.clientX;
        relDragStartY = e.clientY;
        relPanStartX = relPanX;
        relPanStartY = relPanY;
    });
    window.addEventListener('mousemove', (e) => {
        if (!relIsDragging) return;
        relPanX = relPanStartX + (e.clientX - relDragStartX);
        relPanY = relPanStartY + (e.clientY - relDragStartY);
        applyRelationsTransform();
    });
    window.addEventListener('mouseup', () => {
        relIsDragging = false;
    });
    
    // Đăng ký sự kiện cảm ứng trên di động
    if (typeof setupSvgTouchEvents === 'function') {
        setupSvgTouchEvents(canvas);
    }
}

function applyRelationsTransform() {
    const viewport = document.getElementById('rel-viewport');
    if (viewport) {
        viewport.setAttribute('transform', `translate(${relPanX}, ${relPanY}) scale(${relZoom})`);
    }
}

function populateRelationDocSelects() {
    const sourceSelect = document.getElementById('rel-source-doc');
    const targetSelect = document.getElementById('rel-target-doc');
    const filterDoc = document.getElementById('rel-filter-doc');

    const sortedDocs = sortDocsByIssueDate(state.documents);

    [sourceSelect, targetSelect].forEach(sel => {
        const placeholder = sel.options[0];
        sel.innerHTML = '';
        sel.appendChild(placeholder);
        sortedDocs.forEach(doc => {
            const opt = document.createElement('option');
            opt.value = doc.id;
            opt.textContent = `${doc.number ? doc.number + ' - ' : ''}${doc.title}`;
            sel.appendChild(opt);
        });
    });

    const currentFilterVal = filterDoc.value;
    filterDoc.innerHTML = '<option value="all">Tất cả văn bản</option>';
    sortedDocs.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = `${doc.number ? doc.number + ' - ' : ''}${doc.title}`;
        filterDoc.appendChild(opt);
    });
    if (currentFilterVal && state.documents.some(d => String(d.id) === currentFilterVal)) {
        filterDoc.value = currentFilterVal;
    }
}

async function loadRelationsPage() {
    state.relations = await db.getAllRelations();
    populateRelationDocSelects();
    resetRelationDetailPanel();
    relSelectedDocId = null;
    renderRelationsDiagram();
}

function resetRelationDetailPanel() {
    document.getElementById('rel-detail-content').innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding-top: 2rem;">Chọn một nút trên sơ đồ để xem chi tiết</p>`;
}

function renderRelationsDiagram() {
    const svg = document.getElementById('relations-svg');
    const emptyState = document.getElementById('relations-empty');
    const filterTypeVal = document.getElementById('rel-filter-type').value;
    const filterDocVal = document.getElementById('rel-filter-doc').value;
    const filterFieldEl = document.getElementById('rel-filter-field');
    const filterFieldVal = filterFieldEl ? filterFieldEl.value : 'all';

    svg.innerHTML = '';

    let relations = state.relations;
    if (filterTypeVal !== 'all') {
        relations = relations.filter(r => r.relationType === filterTypeVal);
    }
    if (filterDocVal !== 'all') {
        const docIdNum = Number(filterDocVal);
        relations = relations.filter(r => r.sourceDocId === docIdNum || r.targetDocId === docIdNum);
    }
    if (filterFieldVal !== 'all') {
        relations = relations.filter(r => {
            const srcDoc = state.documents.find(d => d.id === r.sourceDocId);
            const tgtDoc = state.documents.find(d => d.id === r.targetDocId);
            return srcDoc && tgtDoc && (
                getDocFields(srcDoc).includes(filterFieldVal) ||
                getDocFields(tgtDoc).includes(filterFieldVal)
            );
        });
    }

    // Collect involved doc ids (only keep ones that still exist)
    const nodeIdSet = new Set();
    relations.forEach(r => {
        nodeIdSet.add(r.sourceDocId);
        nodeIdSet.add(r.targetDocId);
    });

    const nodeDocs = state.documents.filter(d => nodeIdSet.has(d.id));

    if (nodeDocs.length === 0) {
        emptyState.style.display = 'flex';
        return;
    }
    emptyState.style.display = 'none';

    // Group by docType for column layout ("layers" in a Sugiyama-style diagram)
    const columns = {};
    DOC_TYPE_ORDER.forEach(t => columns[t] = []);
    nodeDocs.forEach(doc => {
        const key = DOC_TYPE_ORDER.includes(doc.docType) ? doc.docType : 'Khác';
        columns[key].push(doc);
    });
    const activeColumns = DOC_TYPE_ORDER.filter(t => columns[t].length > 0);

    const nodeWidth = 170;
    const nodeHeight = 54;
    const colGapX = 240;
    const rowGapY = 95;
    const startX = 100;
    const startY = 70;

    // Undirected adjacency within the currently visible node/edge set
    const adjacency = {};
    nodeDocs.forEach(doc => { adjacency[doc.id] = []; });
    relations.forEach(rel => {
        if (adjacency[rel.sourceDocId] && adjacency[rel.targetDocId]) {
            adjacency[rel.sourceDocId].push(rel.targetDocId);
            adjacency[rel.targetDocId].push(rel.sourceDocId);
        }
    });

    // Reorder rows within each column via a barycenter heuristic (a few
    // left-right / right-left sweeps): each node moves toward the average
    // row of its connected neighbors. This is the same technique layered
    // graph tools (e.g. Graphviz dot) use to cut down edge crossings —
    // straight/near-straight edges instead of a tangle of diagonals.
    const rowOrder = {};
    activeColumns.forEach(type => { rowOrder[type] = columns[type].map(d => d.id); });

    const rowIndexOf = (docId) => {
        for (const type of activeColumns) {
            const idx = rowOrder[type].indexOf(docId);
            if (idx !== -1) return idx;
        }
        return 0;
    };

    const SWEEPS = 4;
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
        const sweepOrder = sweep % 2 === 0 ? activeColumns : [...activeColumns].reverse();
        sweepOrder.forEach(type => {
            const ids = rowOrder[type];
            const scored = ids.map((id, origIndex) => {
                const neighbors = adjacency[id];
                const bary = neighbors.length === 0
                    ? origIndex
                    : neighbors.reduce((sum, nId) => sum + rowIndexOf(nId), 0) / neighbors.length;
                return { id, bary, origIndex };
            });
            scored.sort((a, b) => a.bary - b.bary || a.origIndex - b.origIndex);
            rowOrder[type] = scored.map(s => s.id);
        });
    }

    const nodePositions = {};
    let colIndex = 0;
    let maxRows = 1;

    activeColumns.forEach(type => {
        const ids = rowOrder[type];
        ids.forEach((docId, rowIndex) => {
            nodePositions[docId] = {
                x: startX + colIndex * colGapX,
                y: startY + rowIndex * rowGapY,
                col: colIndex,
                row: rowIndex
            };
        });
        maxRows = Math.max(maxRows, ids.length);
        colIndex++;
    });

    const contentWidth = Math.max(900, startX + colIndex * colGapX);
    const contentHeight = Math.max(600, startY + maxRows * rowGapY + 100);

    // Safe horizontal "lanes" above/below every row — guaranteed clear of
    // nodes, used to arc edges that would otherwise cut across other boxes.
    const topLaneY = startY - 40;
    const bottomLaneY = startY + (maxRows - 1) * rowGapY + nodeHeight + 40;

    const edgePort = (pos, side) => {
        const cx = pos.x + nodeWidth / 2;
        const cy = pos.y + nodeHeight / 2;
        if (side === 'right') return { x: pos.x + nodeWidth, y: cy };
        if (side === 'left') return { x: pos.x, y: cy };
        if (side === 'top') return { x: cx, y: pos.y };
        return { x: cx, y: pos.y + nodeHeight };
    };

    const svgNS = 'http://www.w3.org/2000/svg';
    // Keep the SVG filling its container (matches the CSS/HTML sizing); the
    // content itself lives in a pannable/zoomable <g> below, not the SVG viewport.
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.removeAttribute('viewBox');

    // Auto-fit the diagram inside the visible canvas area on every (re)render
    // so newly filtered/added nodes don't end up clipped off-screen.
    const canvasEl = document.getElementById('relations-canvas');
    const canvasRect = canvasEl.getBoundingClientRect();
    const fitScale = Math.min(canvasRect.width / contentWidth, canvasRect.height / contentHeight, 1);
    relZoom = fitScale > 0 ? fitScale : 1;
    relPanX = Math.max(0, (canvasRect.width - contentWidth * relZoom) / 2);
    relPanY = Math.max(20, (canvasRect.height - contentHeight * relZoom) / 2);

    // Arrow marker defs
    const defs = document.createElementNS(svgNS, 'defs');
    Object.keys(RELATION_META).forEach(type => {
        const meta = RELATION_META[type];
        const marker = document.createElementNS(svgNS, 'marker');
        marker.setAttribute('id', `arrow-${type}`);
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '7');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('orient', 'auto-start-reverse');
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', 'M0,0 L10,5 L0,10 z');
        path.setAttribute('fill', meta.color);
        marker.appendChild(path);
        defs.appendChild(marker);
    });
    svg.appendChild(defs);

    const viewport = document.createElementNS(svgNS, 'g');
    viewport.setAttribute('id', 'rel-viewport');
    viewport.setAttribute('transform', `translate(${relPanX}, ${relPanY}) scale(${relZoom})`);

    // Draw edges first (behind nodes). Every edge is a smooth cubic bezier
    // that leaves/enters through the node's border (never its center) and is
    // routed to avoid cutting across any node that isn't its own endpoint:
    //  - adjacent columns / adjacent rows → gentle direct S-curve (nothing in the way)
    //  - same column, rows apart          → bulge out into the empty gutter beside the column
    //  - columns apart (skips a column)   → arc through a lane above/below every row
    const pairCounts = {};
    relations.forEach(rel => {
        const source = nodePositions[rel.sourceDocId];
        const target = nodePositions[rel.targetDocId];
        if (!source || !target) return;
        const meta = RELATION_META[rel.relationType] || RELATION_META.huong_dan;

        const pairKey = [rel.sourceDocId, rel.targetDocId].sort().join('-');
        const curveIndex = pairCounts[pairKey] || 0;
        pairCounts[pairKey] = curveIndex + 1;
        const parallelNudge = curveIndex * 16; // extra separation for duplicate edges between the same pair

        const colGap = target.col - source.col;
        let d;

        if (colGap === 0) {
            const rowGap = Math.abs(target.row - source.row);
            if (rowGap <= 1) {
                const p1 = source.row <= target.row ? edgePort(source, 'bottom') : edgePort(source, 'top');
                const p2 = source.row <= target.row ? edgePort(target, 'top') : edgePort(target, 'bottom');
                const bend = Math.max(Math.abs(p2.y - p1.y) * 0.5, 30) + parallelNudge;
                const dir = p2.y > p1.y ? 1 : -1;
                d = `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + dir * bend}, ${p2.x} ${p2.y - dir * bend}, ${p2.x} ${p2.y}`;
            } else {
                // Rows aren't adjacent — a straight vertical line would run
                // through whichever node sits between them, so swing out
                // sideways into the empty gutter next to the column instead.
                const side = source.col === 0 ? 'right' : 'left';
                const p1 = edgePort(source, side);
                const p2 = edgePort(target, side);
                const bulgeX = p1.x + (side === 'right' ? 1 : -1) * (nodeWidth * 0.55 + parallelNudge);
                d = `M ${p1.x} ${p1.y} C ${bulgeX} ${p1.y}, ${bulgeX} ${p2.y}, ${p2.x} ${p2.y}`;
            }
        } else if (Math.abs(colGap) === 1) {
            const p1 = colGap > 0 ? edgePort(source, 'right') : edgePort(source, 'left');
            const p2 = colGap > 0 ? edgePort(target, 'left') : edgePort(target, 'right');
            const bend = Math.max(Math.abs(p2.x - p1.x) * 0.5, 30);
            const dir = p2.x > p1.x ? 1 : -1;
            d = `M ${p1.x} ${p1.y} C ${p1.x + dir * bend} ${p1.y}, ${p2.x - dir * bend} ${p2.y}, ${p2.x} ${p2.y}`;
        } else {
            // Skips one or more columns — arc through a lane clear of every
            // node rather than cutting across the columns in between.
            const p1 = colGap > 0 ? edgePort(source, 'right') : edgePort(source, 'left');
            const p2 = colGap > 0 ? edgePort(target, 'left') : edgePort(target, 'right');
            const avgY = (p1.y + p2.y) / 2;
            const useTop = avgY < (topLaneY + bottomLaneY) / 2;
            const laneY = (useTop ? topLaneY : bottomLaneY) + (useTop ? -parallelNudge : parallelNudge);
            d = `M ${p1.x} ${p1.y} C ${p1.x} ${laneY}, ${p2.x} ${laneY}, ${p2.x} ${p2.y}`;
        }

        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', meta.color);
        path.setAttribute('stroke-width', meta.width);
        path.setAttribute('stroke-linecap', 'round');
        if (meta.dashed) path.setAttribute('stroke-dasharray', '6,4');
        path.setAttribute('marker-end', `url(#arrow-${rel.relationType})`);
        path.setAttribute('opacity', '0.85');

        const titleEl = document.createElementNS(svgNS, 'title');
        titleEl.textContent = `${meta.label}${rel.note ? ': ' + rel.note : ''}`;
        path.appendChild(titleEl);

        viewport.appendChild(path);
    });

    // Draw nodes
    nodeDocs.forEach(doc => {
        const pos = nodePositions[doc.id];
        if (!pos) return;
        const colorKey = DOC_TYPE_ORDER.includes(doc.docType) ? doc.docType : 'Khác';
        const color = DOC_TYPE_COLORS[colorKey];

        const group = document.createElementNS(svgNS, 'g');
        group.setAttribute('class', 'rel-node-group');
        group.setAttribute('data-doc-id', doc.id);
        if (relSelectedDocId === doc.id) group.classList.add('selected');

        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('class', 'rel-node-rect');
        rect.setAttribute('x', pos.x);
        rect.setAttribute('y', pos.y);
        rect.setAttribute('width', nodeWidth);
        rect.setAttribute('height', nodeHeight);
        rect.setAttribute('rx', 8);
        rect.setAttribute('fill', 'rgba(15, 23, 42, 0.85)');
        rect.setAttribute('stroke', color);
        rect.setAttribute('stroke-width', 2);
        group.appendChild(rect);

        const label1 = document.createElementNS(svgNS, 'text');
        label1.setAttribute('x', pos.x + nodeWidth / 2);
        label1.setAttribute('y', pos.y + 22);
        label1.setAttribute('text-anchor', 'middle');
        label1.setAttribute('font-size', '11');
        label1.setAttribute('font-weight', '700');
        label1.setAttribute('fill', color);
        label1.textContent = doc.number || doc.docType;
        group.appendChild(label1);

        const label2 = document.createElementNS(svgNS, 'text');
        label2.setAttribute('x', pos.x + nodeWidth / 2);
        label2.setAttribute('y', pos.y + 38);
        label2.setAttribute('text-anchor', 'middle');
        label2.setAttribute('font-size', '10');
        label2.setAttribute('fill', '#e2e8f0');
        label2.textContent = doc.title.length > 26 ? doc.title.substring(0, 26) + '...' : doc.title;
        group.appendChild(label2);

        const titleEl = document.createElementNS(svgNS, 'title');
        titleEl.textContent = `${doc.number ? doc.number + ' - ' : ''}${doc.title}`;
        group.appendChild(titleEl);

        group.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.rel-node-group').forEach(g => g.classList.remove('selected'));
            group.classList.add('selected');
            relSelectedDocId = doc.id;
            showRelationDetail(doc.id);
        });

        viewport.appendChild(group);
    });

    svg.appendChild(viewport);
}

async function showRelationDetail(docId) {
    const doc = state.documents.find(d => d.id === docId);
    if (!doc) return;

    const related = state.relations.filter(r => r.sourceDocId === docId || r.targetDocId === docId);
    const content = document.getElementById('rel-detail-content');

    const colorKey = DOC_TYPE_ORDER.includes(doc.docType) ? doc.docType : 'Khác';
    const color = DOC_TYPE_COLORS[colorKey];

    let relationsHtml = '';
    if (related.length === 0) {
        relationsHtml = '<p style="color: var(--text-muted); font-size: 0.8rem;">Chưa có quan hệ nào với văn bản khác.</p>';
    } else {
        relationsHtml = related.map(rel => {
            const isSource = rel.sourceDocId === docId;
            const otherDocId = isSource ? rel.targetDocId : rel.sourceDocId;
            const otherDoc = state.documents.find(d => d.id === otherDocId);
            const meta = RELATION_META[rel.relationType] || RELATION_META.huong_dan;
            const arrow = isSource ? '→' : '←';
            const otherName = otherDoc ? escapeHtml(otherDoc.number || otherDoc.title) : 'N/A';
            return `
                <div class="rel-detail-relation-item">
                    <span class="rel-type-badge" style="background: ${meta.color}33; color: ${meta.color};">${meta.label}</span>
                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${arrow} ${otherName}</span>
                    <button class="action-btn rel-delete-btn" data-rel-id="${rel.id}" title="Xóa quan hệ" style="width: 22px; height: 22px; padding: 2px; flex-shrink: 0;"><i data-lucide="trash-2" style="width: 12px; color: var(--danger-color);"></i></button>
                </div>
            `;
        }).join('');
    }

    content.innerHTML = `
        <div class="rel-detail-doc-card">
            <span class="rel-detail-badge" style="background: ${color}33; color: ${color};">${doc.docType}</span>
            <h4 style="font-size: 0.9rem; margin: 0.5rem 0 0.25rem;">${escapeHtml(doc.number || 'Chưa rõ số hiệu')}</h4>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0;">${escapeHtml(doc.title)}</p>
            <button class="btn-primary rel-view-doc-btn" style="margin-top: 0.75rem; width: 100%; font-size: 0.75rem; padding: 0.4rem;"><i data-lucide="eye" style="width: 14px;"></i> Đọc văn bản</button>
        </div>
        <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.5rem;">MỐI QUAN HỆ (${related.length})</div>
        ${relationsHtml}
    `;

    content.querySelector('.rel-view-doc-btn').addEventListener('click', () => openDocumentInViewer(doc.id));

    content.querySelectorAll('.rel-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm("Xóa quan hệ này?")) {
                await db.deleteRelation(Number(btn.getAttribute('data-rel-id')));
                state.relations = await db.getAllRelations();
                renderRelationsDiagram();
                showRelationDetail(docId);
            }
        });
    });

    lucide.createIcons();
}

// --- Timeline Hiệu Lực Module ---
const TIMELINE_STATUS_COLORS = {
    active: '#10b981',
    expired: '#ef4444',
    unknown: '#6b7280'
};

function parseVNDate(str) {
    if (!str) return null;
    const match = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day);
    return isNaN(date.getTime()) ? null : date;
}

function formatVNDate(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${date.getFullYear()}`;
}

// Default ordering across the Library table and every document dropdown:
// document type order (Luật > Nghị định > Thông tư > Công văn > Quyết định > Khác) first, then newest ngày ban hành.
function sortDocsByIssueDate(docs) {
    const getPriority = (type) => {
        if (type === 'Luật') return 1;
        if (type === 'Nghị định') return 2;
        if (type === 'Thông tư') return 3;
        if (type === 'Công văn') return 4;
        if (type === 'Quyết định') return 5;
        return 6;
    };

    return docs.slice().sort((a, b) => {
        // 1. Compare document type first
        const prioA = getPriority(a.docType);
        const prioB = getPriority(b.docType);
        if (prioA !== prioB) return prioA - prioB;
        
        // 2. Compare dates second
        const dateA = parseVNDate(a.issueDate);
        const dateB = parseVNDate(b.issueDate);
        if (dateA && dateB) return dateB - dateA;
        if (dateA && !dateB) return -1;
        if (!dateA && dateB) return 1;
        return 0;
    });
}

function getDocTimelineInfo(doc, today) {
    const startDate = parseVNDate(doc.effectiveDate) || parseVNDate(doc.issueDate);
    const endDate = parseVNDate(doc.expiryDate);

    if (!startDate) return { status: 'unknown', startDate: null, endDate: null };
    if (endDate && endDate < today) return { status: 'expired', startDate, endDate };
    return { status: 'active', startDate, endDate };
}

function setupTimelineHandlers() {
    document.getElementById('timeline-filter-field').addEventListener('change', renderTimeline);
    document.getElementById('timeline-filter-type').addEventListener('change', renderTimeline);
    document.getElementById('timeline-filter-status').addEventListener('change', renderTimeline);
}

function renderTimeline() {
    const rowsContainer = document.getElementById('timeline-rows');
    const axisTrack = document.getElementById('timeline-axis-track');
    const emptyState = document.getElementById('timeline-empty');
    if (!rowsContainer || !axisTrack || !emptyState) return;

    const fieldFilter = document.getElementById('timeline-filter-field').value;
    const typeFilter = document.getElementById('timeline-filter-type').value;
    const statusFilter = document.getElementById('timeline-filter-status').value;

    rowsContainer.innerHTML = '';
    axisTrack.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let items = state.documents.map(doc => ({ doc, ...getDocTimelineInfo(doc, today) }));

    if (fieldFilter !== 'all') items = items.filter(it => getDocFields(it.doc).includes(fieldFilter));
    if (typeFilter !== 'all') items = items.filter(it => it.doc.docType === typeFilter);
    if (statusFilter !== 'all') items = items.filter(it => it.status === statusFilter);

    if (items.length === 0) {
        emptyState.style.display = 'flex';
        return;
    }
    emptyState.style.display = 'none';

    // Sort by start date ascending; docs without a usable date go last
    items.sort((a, b) => {
        if (a.startDate && b.startDate) return a.startDate - b.startDate;
        if (a.startDate) return -1;
        if (b.startDate) return 1;
        return 0;
    });

    const datedItems = items.filter(it => it.startDate);

    let minDate, maxDate;
    if (datedItems.length > 0) {
        const minRaw = new Date(Math.min(...datedItems.map(it => it.startDate.getTime())));
        const maxRaw = new Date(Math.max(...datedItems.map(it => (it.endDate || today).getTime()), today.getTime()));
        minDate = new Date(minRaw.getFullYear(), minRaw.getMonth() - 2, 1);
        maxDate = new Date(maxRaw.getFullYear(), maxRaw.getMonth() + 3, 1);
    } else {
        minDate = new Date(today.getFullYear() - 1, 0, 1);
        maxDate = new Date(today.getFullYear() + 1, 0, 1);
    }

    const rangeMs = maxDate.getTime() - minDate.getTime() || 1;
    const pct = (date) => {
        const clamped = Math.min(Math.max(date.getTime(), minDate.getTime()), maxDate.getTime());
        return ((clamped - minDate.getTime()) / rangeMs) * 100;
    };

    // Build axis ticks — yearly for wide ranges, quarterly for narrower ones.
    // Step size is derived from the actual track width so labels never overlap.
    const rangeYears = (maxDate.getFullYear() - minDate.getFullYear()) + 1;
    const axisTrackWidth = axisTrack.getBoundingClientRect().width || 600;
    const maxTicks = Math.max(2, Math.floor(axisTrackWidth / 70));
    const ticks = [];
    if (rangeYears > 3) {
        const yearStep = Math.max(1, Math.ceil(rangeYears / maxTicks));
        for (let y = minDate.getFullYear(); y <= maxDate.getFullYear(); y += yearStep) {
            const tickDate = new Date(y, 0, 1);
            if (tickDate >= minDate && tickDate <= maxDate) ticks.push({ date: tickDate, label: String(y) });
        }
    } else {
        const totalQuarters = Math.max(1, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24 * 91)));
        const quarterStep = Math.max(1, Math.ceil(totalQuarters / maxTicks));
        let cursor = new Date(minDate.getFullYear(), Math.floor(minDate.getMonth() / 3) * 3, 1);
        let qIndex = 0;
        while (cursor <= maxDate) {
            if (qIndex % quarterStep === 0) {
                ticks.push({ date: new Date(cursor), label: `T${cursor.getMonth() + 1}/${cursor.getFullYear()}` });
            }
            cursor.setMonth(cursor.getMonth() + 3);
            qIndex++;
        }
    }

    ticks.forEach(tick => {
        const tickEl = document.createElement('div');
        tickEl.className = 'timeline-axis-tick';
        tickEl.style.left = `${pct(tick.date)}%`;
        tickEl.innerHTML = `<span>${tick.label}</span>`;
        axisTrack.appendChild(tickEl);
    });

    const axisTodayMarker = document.createElement('div');
    axisTodayMarker.className = 'timeline-today-marker';
    axisTodayMarker.style.left = `${pct(today)}%`;
    axisTodayMarker.title = `Hôm nay: ${formatVNDate(today)}`;
    axisTrack.appendChild(axisTodayMarker);

    items.forEach(item => {
        const { doc, status, startDate, endDate } = item;
        const row = document.createElement('div');
        row.className = 'timeline-row';

        const label = document.createElement('div');
        label.className = 'timeline-row-label';
        label.innerHTML = `
            <div class="tl-number">${escapeHtml(doc.number || doc.docType)}</div>
            <div class="tl-title">${escapeHtml(doc.title)}</div>
        `;
        label.addEventListener('click', () => openDocumentInViewer(doc.id));
        row.appendChild(label);

        const track = document.createElement('div');
        track.className = 'timeline-row-track';

        if (startDate) {
            const leftPct = pct(startDate);
            const rightPct = endDate ? pct(endDate) : 100;
            const widthPct = Math.max(rightPct - leftPct, 0.6);

            const bar = document.createElement('div');
            bar.className = 'timeline-bar' + (endDate ? '' : ' ongoing');
            bar.style.left = `${leftPct}%`;
            bar.style.width = `${widthPct}%`;
            bar.style.background = TIMELINE_STATUS_COLORS[status];
            const statusLabel = status === 'active' ? 'Còn hiệu lực' : (status === 'expired' ? 'Hết hiệu lực' : 'Chưa xác định');
            bar.title = `${doc.number ? doc.number + ' - ' : ''}${doc.title}\nHiệu lực từ: ${formatVNDate(startDate)}\n${endDate ? 'Hết hiệu lực: ' + formatVNDate(endDate) : 'Chưa có ngày hết hiệu lực'}\nTrạng thái: ${statusLabel}`;
            bar.addEventListener('click', () => openDocumentInViewer(doc.id));
            track.appendChild(bar);

            // Drawn per-row (not once globally) so it lines up under the shared-width track column
            const rowTodayMarker = document.createElement('div');
            rowTodayMarker.className = 'timeline-today-marker';
            rowTodayMarker.style.left = `${pct(today)}%`;
            track.appendChild(rowTodayMarker);
        } else {
            const note = document.createElement('div');
            note.className = 'timeline-unknown-note';
            note.textContent = 'Chưa nhập ngày hiệu lực';
            track.appendChild(note);
        }

        row.appendChild(track);
        rowsContainer.appendChild(row);
    });
}

// --- Google Drive Sync & Mobile Support Module ---
const DEFAULT_CLIENT_ID = '593450953460-7p72k2chgr0nscqg631b5qsn9om4h44f.apps.googleusercontent.com'; // Client ID mặc định cho localhost:8090

let tokenClient;
let accessToken = null;
let syncTimeout = null;
let isSyncing = false;

// Khởi tạo Google OAuth Client
function initGoogleAuth() {
    const clientId = localStorage.getItem('gdrive_client_id') || DEFAULT_CLIENT_ID;
    if (typeof google === 'undefined' || !google.accounts) {
        console.warn("Chưa tải được thư viện Google API client.");
        return;
    }
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'https://www.googleapis.com/auth/drive.file',
            callback: async (response) => {
                if (response.error !== undefined) {
                    console.error("Lỗi xác thực OAuth:", response);
                    alert("Lỗi kết nối Google Drive: " + response.error);
                    return;
                }
                accessToken = response.access_token;
                localStorage.setItem('gdrive_access_token', accessToken);
                localStorage.setItem('gdrive_token_expiry', Date.now() + (response.expires_in * 1000));
                
                updateDriveStatusUI(true, "Đã kết nối");
                await syncWithGoogleDrive(false, true);
            },
        });
    } catch (err) {
        console.error("Lỗi khởi chạy Google Auth Client:", err);
    }
}

// Cập nhật trạng thái hiển thị của Google Drive trên UI
function updateDriveStatusUI(connected, text, hasError = false) {
    const loginBtn = document.getElementById('gdrive-login-btn');
    const statusContainer = document.getElementById('gdrive-status-container');
    const statusText = document.getElementById('gdrive-sync-status');
    const statusDot = statusContainer ? statusContainer.querySelector('.status-dot') : null;

    if (!loginBtn || !statusContainer || !statusText) return;

    if (connected) {
        loginBtn.style.display = 'none';
        statusContainer.style.display = 'flex';
        statusText.textContent = text;
        
        if (statusDot) {
            if (hasError) {
                statusDot.style.background = '#ef4444';
                statusDot.style.boxShadow = '0 0 6px #ef4444';
            } else if (text.includes("Đang")) {
                statusDot.style.background = '#f59e0b';
                statusDot.style.boxShadow = '0 0 6px #f59e0b';
            } else {
                statusDot.style.background = '#10b981';
                statusDot.style.boxShadow = '0 0 6px #10b981';
            }
        }
    } else {
        loginBtn.style.display = 'flex';
        statusContainer.style.display = 'none';
    }
}

// Phục hồi phiên làm việc Google Drive khi tải trang
function restoreGoogleDriveSession() {
    const storedToken = localStorage.getItem('gdrive_access_token');
    const expiry = localStorage.getItem('gdrive_token_expiry');
    if (storedToken && expiry && Number(expiry) > Date.now()) {
        accessToken = storedToken;
        updateDriveStatusUI(true, `Đã kết nối`);
        
        // Tự động đồng bộ ngay khi load trang
        setTimeout(() => {
            syncWithGoogleDrive();
        }, 1000);
    }
}

// Gọi kết nối Google Drive (hiện pop-up đăng nhập)
function connectGoogleDrive() {
    if (!tokenClient) {
        initGoogleAuth();
    }
    if (tokenClient) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        alert("Thư viện Google API chưa sẵn sàng. Vui lòng kiểm tra lại mạng Internet.");
    }
}

// Đăng xuất Google Drive
function disconnectGoogleDrive() {
    if (accessToken) {
        try {
            google.accounts.oauth2.revokeToken(accessToken, () => {});
        } catch (e) {}
    }
    accessToken = null;
    localStorage.removeItem('gdrive_access_token');
    localStorage.removeItem('gdrive_token_expiry');
    updateDriveStatusUI(false);
}

// Google Drive API: Tìm file đồng bộ
async function findSyncFile() {
    const query = encodeURIComponent("name = 'legaldoc_sync_data.json' and trashed = false");
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) {
        let errMsg = `Lỗi kết nối API Google Drive (Status: ${response.status})`;
        try {
            const errData = await response.json();
            if (errData && errData.error && errData.error.message) {
                errMsg += `: ${errData.error.message}`;
            }
        } catch(e) {}
        throw new Error(errMsg);
    }
    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0] : null;
}

// Google Drive API: Tải nội dung file
async function downloadSyncFile(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) {
        let errMsg = `Lỗi tải nội dung file từ Google Drive (Status: ${response.status})`;
        try {
            const errData = await response.json();
            if (errData && errData.error && errData.error.message) {
                errMsg += `: ${errData.error.message}`;
            }
        } catch(e) {}
        throw new Error(errMsg);
    }
    return await response.json();
}

// Google Drive API: Tải dữ liệu lên (Thêm mới hoặc Cập nhật)
async function uploadSyncFile(fileId, contentObj) {
    const boundary = 'gdrive_sync_multipart_boundary';
    const metadata = {
        name: 'legaldoc_sync_data.json',
        mimeType: 'application/json'
    };
    
    const contentStr = JSON.stringify(contentObj);
    
    let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    let method = 'POST';
    
    if (fileId) {
        url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
        method = 'PATCH';
    }
    
    const multipartBody = 
        `\r\n--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `\r\n--${boundary}\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        `${contentStr}\r\n` +
        `\r\n--${boundary}--`;
        
    const response = await fetch(url, {
        method: method,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
    });
    
    if (!response.ok) {
        let errMsg = `Lỗi lưu file lên Google Drive (Status: ${response.status})`;
        try {
            const errData = await response.json();
            if (errData && errData.error && errData.error.message) {
                errMsg += `: ${errData.error.message}`;
            }
        } catch(e) {}
        throw new Error(errMsg);
    }
    return await response.json();
}

// Hàm đồng bộ chính (Đọc -> Trộn -> Ghi)
async function syncWithGoogleDrive(forceUpload = false, isManual = false) {
    if (!accessToken) return;
    if (isSyncing) return;
    isSyncing = true;
    
    updateDriveStatusUI(true, "Đang đồng bộ...");
    
    try {
        const file = await findSyncFile();
        let remoteData = null;
        let fileId = file ? file.id : null;
        
        if (fileId && !forceUpload) {
            remoteData = await downloadSyncFile(fileId);
        }
        
        if (remoteData && !forceUpload) {
            await db.mergeDatabase(remoteData);
            // Ngừng gọi triggerAutoSync trong reloadData khi đang đồng bộ để tránh lặp vô hạn
            const oldAutoSync = triggerAutoSync;
            triggerAutoSync = () => {}; 
            await reloadData();
            triggerAutoSync = oldAutoSync;
        }
        
        const mergedExport = await db.getExportData();
        await uploadSyncFile(fileId, mergedExport);
        
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        updateDriveStatusUI(true, `Đồng bộ: ${timeStr}`);
    } catch (e) {
        console.error("Lỗi đồng bộ đám mây:", e);
        updateDriveStatusUI(true, "Lỗi đồng bộ", true);
        if (isManual) {
            alert("Lỗi đồng bộ đám mây:\n" + e.message + "\n\n(Lưu ý: Nếu lỗi 403 Forbidden, bạn cần vào Google Cloud Console và BẬT 'Google Drive API' cho dự án của mình)");
        }
    } finally {
        isSyncing = false;
    }
}

// Kích hoạt đồng bộ tự động sau thao tác của người dùng (debounce 5 giây)
function triggerAutoSync() {
    if (!accessToken) return;
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        syncWithGoogleDrive();
    }, 5000);
}

// Đăng ký các sự kiện Click cho nút UI trong Header
function setupGDriveUIHandlers() {
    const loginBtn = document.getElementById('gdrive-login-btn');
    const logoutBtn = document.getElementById('gdrive-logout-btn');
    const syncBtn = document.getElementById('gdrive-sync-now-btn');

    if (loginBtn) loginBtn.addEventListener('click', connectGoogleDrive);
    if (logoutBtn) logoutBtn.addEventListener('click', disconnectGoogleDrive);
    if (syncBtn) syncBtn.addEventListener('click', () => syncWithGoogleDrive(false, true));
}

// --- Mobile Support: LAN IP & QR Code & Touch SVG ---

async function setupMobileSync() {
    const qrBtn = document.getElementById('qr-trigger-btn');
    const qrModal = document.getElementById('qr-modal-overlay');
    const qrClose = document.getElementById('qr-modal-close');
    const qrLink = document.getElementById('qr-lan-link');
    const qrContainer = document.getElementById('qrcode-container');

    if (!qrBtn || !qrModal || !qrClose) return;

    // Đóng mở modal QR Code
    qrBtn.addEventListener('click', async () => {
        qrContainer.innerHTML = 'Đang lấy thông tin server...';
        qrModal.style.display = 'flex';
        
        try {
            // Lấy IP mạng LAN từ server tùy biến
            const response = await fetch('/api/server-info');
            const data = await response.json();
            
            qrContainer.innerHTML = '';
            qrLink.href = data.url;
            qrLink.textContent = data.url;
            
            // Vẽ mã QR Code
            new QRCode(qrContainer, {
                text: data.url,
                width: 180,
                height: 180,
                colorDark : "#0f172a",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.H
            });
        } catch (e) {
            console.error("Không thể kết nối lấy IP server:", e);
            qrContainer.innerHTML = '<span style="color: var(--danger-color); font-size: 0.8rem;">Không kết nối được server.<br>Vui lòng chạy KhoiDong.bat!</span>';
        }
    });

    qrClose.addEventListener('click', () => {
        qrModal.style.display = 'none';
    });
}

function setupGDriveSettingsHandlers() {
    const settingsBtn = document.getElementById('gdrive-settings-btn');
    const settingsModal = document.getElementById('gdrive-settings-overlay');
    const settingsClose = document.getElementById('gdrive-settings-close');
    const settingsSave = document.getElementById('gdrive-settings-save-btn');
    const clientInput = document.getElementById('gdrive-client-id-input');

    if (!settingsBtn || !settingsModal || !settingsClose || !settingsSave) return;

    settingsBtn.addEventListener('click', () => {
        clientInput.value = localStorage.getItem('gdrive_client_id') || '';
        settingsModal.style.display = 'flex';
    });

    settingsClose.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });

    settingsSave.addEventListener('click', () => {
        const val = clientInput.value.trim();
        if (val) {
            localStorage.setItem('gdrive_client_id', val);
        } else {
            localStorage.removeItem('gdrive_client_id');
        }
        settingsModal.style.display = 'none';
        
        // Khởi tạo lại auth client với client ID mới
        initGoogleAuth();
        alert("Đã lưu cấu hình Client ID mới thành công!");
    });
}

// Đăng ký các hàm sự kiện chạm vuốt SVG Canvas ở sơ đồ quan hệ
function setupSvgTouchEvents(canvas) {
    if (!canvas) return;
    
    canvas.addEventListener('touchstart', (e) => {
        if (e.target.closest('.rel-node-group')) return;
        if (e.touches.length === 1) {
            relIsDragging = true;
            relDragStartX = e.touches[0].clientX;
            relDragStartY = e.touches[0].clientY;
            relPanStartX = relPanX;
            relPanStartY = relPanY;
        } else if (e.touches.length === 2) {
            relIsDragging = false;
            canvas.dataset.pinchStartDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            canvas.dataset.pinchStartZoom = relZoom;
        }
    });

    window.addEventListener('touchmove', (e) => {
        if (relIsDragging || (canvas.dataset.pinchStartDist && e.touches.length === 2)) {
            // Prevent native page scrolling and bouncing on iOS while interacting with the SVG Canvas
            if (e.cancelable) e.preventDefault();
        }
        if (relIsDragging && e.touches.length === 1) {
            relPanX = relPanStartX + (e.touches[0].clientX - relDragStartX);
            relPanY = relPanStartY + (e.touches[0].clientY - relDragStartY);
            applyRelationsTransform();
        } else if (e.touches.length === 2 && canvas.dataset.pinchStartDist) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const startDist = parseFloat(canvas.dataset.pinchStartDist);
            const startZoom = parseFloat(canvas.dataset.pinchStartZoom);
            if (startDist > 0) {
                const scale = dist / startDist;
                relZoom = Math.min(Math.max(startZoom * scale, 0.2), 3.0);
                applyRelationsTransform();
            }
        }
    }, { passive: false });

    window.addEventListener('touchend', () => {
        relIsDragging = false;
        delete canvas.dataset.pinchStartDist;
        delete canvas.dataset.pinchStartZoom;
    });
}

// --- Dynamic Field Taxonomy Management Page Logic ---

// Render danh sách quản lý lĩnh vực
function renderFieldsManagementUI() {
    const container = document.getElementById('fields-tree-container');
    if (!container) return;

    container.innerHTML = '';
    
    // Nạp lại dữ liệu cho select box chọn nhóm ở form thêm lĩnh vực
    const newFieldGroupSelect = document.getElementById('new-field-group');
    if (newFieldGroupSelect) {
        newFieldGroupSelect.innerHTML = '<option value="">-- Độc lập (Không thuộc nhóm nào) --</option>';
        FIELD_HIERARCHY.forEach(section => {
            if (section.group) {
                newFieldGroupSelect.innerHTML += `<option value="${escapeHtml(section.group)}">${escapeHtml(section.group)}</option>`;
            }
        });
    }

    // Vẽ danh sách nhóm và các lĩnh vực thuộc nhóm
    FIELD_HIERARCHY.forEach(section => {
        if (section.group) {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'fields-tree-group';
            
            const fieldsListHtml = section.fields.map(f => `
                <div class="field-node-row">
                    <div>
                        <i data-lucide="file-text" style="width: 13px; color: var(--text-muted); vertical-align: middle; margin-right: 0.4rem;"></i>
                        <span class="field-node-label">${escapeHtml(f.label)}</span>
                        <span class="field-node-value">${escapeHtml(f.value)}</span>
                    </div>
                    <div class="field-node-actions">
                        <button class="fields-action-btn edit-field-btn" data-value="${escapeHtml(f.value)}" data-label="${escapeHtml(f.label)}" data-group="${escapeHtml(section.group)}" title="Sửa lĩnh vực"><i data-lucide="pencil" style="width: 12px;"></i></button>
                        <button class="fields-action-btn delete delete-field-btn" data-value="${escapeHtml(f.value)}" title="Xóa lĩnh vực"><i data-lucide="trash-2" style="width: 12px;"></i></button>
                    </div>
                </div>
            `).join('');

            groupDiv.innerHTML = `
                <div class="fields-tree-group-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <i data-lucide="folder" style="width: 16px; color: var(--warning-color); vertical-align: middle;"></i>
                        <span>${escapeHtml(section.group)}</span>
                        <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">(${section.fields.length} lĩnh vực)</span>
                    </div>
                    <div class="group-node-actions">
                        <button class="fields-action-btn edit-group-btn" data-group="${escapeHtml(section.group)}" title="Sửa tên nhóm"><i data-lucide="pencil" style="width: 12px;"></i></button>
                        <button class="fields-action-btn delete delete-group-btn" data-group="${escapeHtml(section.group)}" title="Xóa nhóm"><i data-lucide="trash-2" style="width: 12px;"></i></button>
                    </div>
                </div>
                <div class="fields-tree-fields-list">
                    ${fieldsListHtml}
                    ${section.fields.length === 0 ? `<div style="font-size: 0.8rem; color: var(--text-muted); padding: 0.5rem; text-align: center; font-style: italic;">Nhóm này chưa có lĩnh vực nào</div>` : ''}
                </div>
            `;
            container.appendChild(groupDiv);
        }
    });

    // Vẽ danh sách các lĩnh vực độc lập
    const standalones = FIELD_HIERARCHY.filter(section => !section.group);
    const hasStandaloneFields = standalones.some(s => s.fields && s.fields.length > 0);
    
    if (hasStandaloneFields) {
        const standaloneContainer = document.createElement('div');
        standaloneContainer.className = 'fields-tree-standalone';
        standaloneContainer.innerHTML = `<div class="fields-tree-standalone-title">Lĩnh vực độc lập (Không phân nhóm)</div>`;
        
        const fieldsList = document.createElement('div');
        fieldsList.className = 'fields-tree-fields-list';
        fieldsList.style.padding = '0';
        
        standalones.forEach(section => {
            section.fields.forEach(f => {
                const fieldRow = document.createElement('div');
                fieldRow.className = 'field-node-row';
                fieldRow.innerHTML = `
                    <div>
                        <i data-lucide="file-text" style="width: 13px; color: var(--text-muted); vertical-align: middle; margin-right: 0.4rem;"></i>
                        <span class="field-node-label">${escapeHtml(f.label)}</span>
                        <span class="field-node-value">${escapeHtml(f.value)}</span>
                    </div>
                    <div class="field-node-actions">
                        <button class="fields-action-btn edit-field-btn" data-value="${escapeHtml(f.value)}" data-label="${escapeHtml(f.label)}" data-group="" title="Sửa lĩnh vực"><i data-lucide="pencil" style="width: 12px;"></i></button>
                        <button class="fields-action-btn delete delete-field-btn" data-value="${escapeHtml(f.value)}" title="Xóa lĩnh vực"><i data-lucide="trash-2" style="width: 12px;"></i></button>
                    </div>
                `;
                fieldsList.appendChild(fieldRow);
            });
        });
        
        standaloneContainer.appendChild(fieldsList);
        container.appendChild(standaloneContainer);
    }
    
    lucide.createIcons();
    setupFieldsManagementUIEvents();
}

// Gán sự kiện cho trang quản lý lĩnh vực
function setupFieldsManagementUIEvents() {
    // 1. Thêm nhóm lĩnh vực mới
    const newGroupNameInput = document.getElementById('new-group-name');
    const addGroupBtn = document.getElementById('add-group-btn');
    if (addGroupBtn && !addGroupBtn.dataset.listener) {
        addGroupBtn.dataset.listener = 'true';
        addGroupBtn.addEventListener('click', () => {
            const groupName = newGroupNameInput.value.trim();
            if (!groupName) {
                alert("Vui lòng nhập tên nhóm!");
                return;
            }
            
            const exists = FIELD_HIERARCHY.some(sec => sec.group && sec.group.toLowerCase() === groupName.toLowerCase());
            if (exists) {
                alert("Nhóm này đã tồn tại!");
                return;
            }
            
            const newHierarchy = [...FIELD_HIERARCHY];
            newHierarchy.push({ group: groupName, fields: [] });
            saveFieldHierarchy(newHierarchy);
            newGroupNameInput.value = '';
            alert(`Đã tạo nhóm "${groupName}" thành công!`);
        });
    }

    // 2. Thêm lĩnh vực mới
    const newFieldLabelInput = document.getElementById('new-field-label');
    const newFieldGroupSelect = document.getElementById('new-field-group');
    const addFieldBtn = document.getElementById('add-field-btn');
    if (addFieldBtn && !addFieldBtn.dataset.listener) {
        addFieldBtn.dataset.listener = 'true';
        addFieldBtn.addEventListener('click', () => {
            const label = newFieldLabelInput.value.trim();
            const groupName = newFieldGroupSelect.value;
            if (!label) {
                alert("Vui lòng nhập tên lĩnh vực!");
                return;
            }
            
            const value = label; // Dùng trực tiếp nhãn làm giá trị phân loại
            let fieldExists = false;
            FIELD_HIERARCHY.forEach(sec => {
                if (sec.fields.some(f => f.value.toLowerCase() === value.toLowerCase())) {
                    fieldExists = true;
                }
            });
            if (fieldExists) {
                alert("Lĩnh vực này đã tồn tại trong hệ thống!");
                return;
            }
            
            const newHierarchy = JSON.parse(JSON.stringify(FIELD_HIERARCHY));
            if (groupName) {
                const targetSec = newHierarchy.find(sec => sec.group === groupName);
                if (targetSec) {
                    targetSec.fields.push({ value, label });
                }
            } else {
                let nullSec = newHierarchy.find(sec => !sec.group);
                if (!nullSec) {
                    nullSec = { group: null, fields: [] };
                    newHierarchy.push(nullSec);
                }
                nullSec.fields.push({ value, label });
            }
            
            saveFieldHierarchy(newHierarchy);
            newFieldLabelInput.value = '';
            alert(`Đã thêm lĩnh vực "${label}" thành công!`);
        });
    }

    // 3. Đặt lại mặc định
    const resetBtn = document.getElementById('reset-fields-default-btn');
    if (resetBtn && !resetBtn.dataset.listener) {
        resetBtn.dataset.listener = 'true';
        resetBtn.addEventListener('click', () => {
            if (confirm("Bạn có chắc chắn muốn khôi phục danh mục lĩnh vực quy định về cấu hình mặc định ban đầu của hệ thống?")) {
                saveFieldHierarchy(JSON.parse(JSON.stringify(DEFAULT_FIELD_HIERARCHY)));
                alert("Đã khôi phục cài đặt mặc định thành công!");
            }
        });
    }

    // 4. Các nút sửa nhóm
    document.querySelectorAll('.edit-group-btn').forEach(btn => {
        btn.onclick = () => {
            const groupName = btn.getAttribute('data-group');
            openEditFieldItemModal('group', groupName);
        };
    });

    // 5. Các nút xóa nhóm
    document.querySelectorAll('.delete-group-btn').forEach(btn => {
        btn.onclick = () => {
            const groupName = btn.getAttribute('data-group');
            deleteFieldGroup(groupName);
        };
    });

    // 6. Các nút sửa lĩnh vực
    document.querySelectorAll('.edit-field-btn').forEach(btn => {
        btn.onclick = () => {
            const val = btn.getAttribute('data-value');
            const label = btn.getAttribute('data-label');
            const group = btn.getAttribute('data-group');
            openEditFieldItemModal('field', val, label, group);
        };
    });

    // 7. Các nút xóa lĩnh vực
    document.querySelectorAll('.delete-field-btn').forEach(btn => {
        btn.onclick = () => {
            const val = btn.getAttribute('data-value');
            deleteField(val);
        };
    });
}

// Xóa nhóm lĩnh vực
function deleteFieldGroup(groupName) {
    const section = FIELD_HIERARCHY.find(sec => sec.group === groupName);
    if (!section) return;
    
    const count = section.fields.length;
    let message = `Bạn có chắc muốn xóa nhóm "${groupName}" không?`;
    if (count > 0) {
        message += `\n\nNhóm này đang chứa ${count} lĩnh vực con. Hãy chọn cách xử lý:\n- Nhấn OK: Giữ lại các lĩnh vực con này và chuyển chúng thành lĩnh vực độc lập.\n- Nhấn Cancel: Hủy bỏ thao tác xóa.`;
    }
    
    if (confirm(message)) {
        let newHierarchy = JSON.parse(JSON.stringify(FIELD_HIERARCHY));
        const index = newHierarchy.findIndex(sec => sec.group === groupName);
        
        if (index !== -1) {
            const fieldsToKeep = newHierarchy[index].fields;
            newHierarchy.splice(index, 1);
            
            if (fieldsToKeep.length > 0) {
                let standaloneSec = newHierarchy.find(sec => !sec.group);
                if (!standaloneSec) {
                    standaloneSec = { group: null, fields: [] };
                    newHierarchy.push(standaloneSec);
                }
                standaloneSec.fields.push(...fieldsToKeep);
            }
            
            saveFieldHierarchy(newHierarchy);
            alert(`Đã xóa nhóm "${groupName}"!`);
        }
    }
}

// Xóa lĩnh vực
async function deleteField(fieldValue) {
    const docs = state.documents || [];
    const count = docs.filter(d => getDocFields(d).includes(fieldValue)).length;
    
    let confirmMsg = `Bạn có chắc chắn muốn xóa lĩnh vực "${fieldValue}" không?`;
    if (count > 0) {
        confirmMsg += `\n\nCảnh báo: Hiện có ${count} văn bản đang được phân loại thuộc lĩnh vực này. Lĩnh vực sẽ bị xóa khỏi các văn bản đó.`;
    }
    
    if (confirm(confirmMsg)) {
        if (count > 0) {
            try {
                await db.removeFieldFromDocuments(fieldValue);
                await reloadData();
            } catch (e) {
                console.error("Lỗi khi xóa lĩnh vực khỏi văn bản:", e);
                alert("Lỗi khi cập nhật cơ sở dữ liệu!");
                return;
            }
        }
        
        let newHierarchy = JSON.parse(JSON.stringify(FIELD_HIERARCHY));
        newHierarchy.forEach(sec => {
            sec.fields = sec.fields.filter(f => f.value !== fieldValue);
        });
        
        newHierarchy = newHierarchy.filter(sec => sec.group || sec.fields.length > 0);
        
        saveFieldHierarchy(newHierarchy);
        alert(`Đã xóa lĩnh vực "${fieldValue}" thành công!`);
    }
}

// Mở modal sửa nhóm/lĩnh vực
function openEditFieldItemModal(type, oldVal, label = '', group = '') {
    const modal = document.getElementById('edit-field-item-modal');
    if (!modal) return;
    
    document.getElementById('edit-field-item-type').value = type;
    document.getElementById('edit-field-item-old-val').value = oldVal;
    
    const titleEl = document.getElementById('edit-field-modal-title');
    const nameLabel = document.getElementById('edit-field-item-name-label');
    const nameInput = document.getElementById('edit-field-item-name');
    const labelRow = document.getElementById('edit-field-group-only-fields');
    const labelInput = document.getElementById('edit-field-item-label');
    const parentGroupRow = document.getElementById('edit-field-parent-group-row');
    const parentGroupSelect = document.getElementById('edit-field-parent-group');
    
    if (type === 'group') {
        titleEl.textContent = "Chỉnh sửa Nhóm Lĩnh vực";
        nameLabel.textContent = "Tên nhóm lĩnh vực";
        nameInput.value = oldVal;
        labelRow.style.display = 'none';
        parentGroupRow.style.display = 'none';
    } else {
        titleEl.textContent = "Chỉnh sửa Lĩnh vực Quy định";
        nameLabel.textContent = "Giá trị/Mã lĩnh vực (VD: Thuế GTGT)";
        nameInput.value = oldVal;
        
        labelRow.style.display = 'block';
        labelInput.value = label || oldVal;
        
        parentGroupRow.style.display = 'block';
        parentGroupSelect.innerHTML = '<option value="">-- Độc lập (Không thuộc nhóm nào) --</option>';
        FIELD_HIERARCHY.forEach(sec => {
            if (sec.group) {
                parentGroupSelect.innerHTML += `<option value="${escapeHtml(sec.group)}"${sec.group === group ? ' selected' : ''}>${escapeHtml(sec.group)}</option>`;
            }
        });
    }
    
    modal.style.display = 'flex';
}

// Khởi tạo các sự kiện cho modal chỉnh sửa
function setupEditFieldItemModalHandlers() {
    const modal = document.getElementById('edit-field-item-modal');
    const closeBtn = document.getElementById('edit-field-modal-close');
    const cancelBtn = document.getElementById('edit-field-modal-cancel-btn');
    const saveBtn = document.getElementById('edit-field-modal-save-btn');
    
    if (!modal || !saveBtn) return;
    
    const closeModal = () => { modal.style.display = 'none'; };
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    
    saveBtn.onclick = async () => {
        const type = document.getElementById('edit-field-item-type').value;
        const oldVal = document.getElementById('edit-field-item-old-val').value;
        const newName = document.getElementById('edit-field-item-name').value.trim();
        
        if (!newName) {
            alert("Tên không được để trống!");
            return;
        }
        
        let newHierarchy = JSON.parse(JSON.stringify(FIELD_HIERARCHY));
        
        if (type === 'group') {
            if (oldVal.toLowerCase() !== newName.toLowerCase()) {
                if (newHierarchy.some(sec => sec.group && sec.group.toLowerCase() === newName.toLowerCase())) {
                    alert("Nhóm này đã tồn tại!");
                    return;
                }
            }
            
            const targetSec = newHierarchy.find(sec => sec.group === oldVal);
            if (targetSec) {
                targetSec.group = newName;
            }
            saveFieldHierarchy(newHierarchy);
            closeModal();
            alert(`Đã đổi tên nhóm thành "${newName}"!`);
        } else {
            const newLabel = document.getElementById('edit-field-item-label').value.trim() || newName;
            const newParentGroup = document.getElementById('edit-field-parent-group').value;
            
            if (oldVal.toLowerCase() !== newName.toLowerCase()) {
                let duplicate = false;
                newHierarchy.forEach(sec => {
                    if (sec.fields.some(f => f.value.toLowerCase() === newName.toLowerCase())) {
                        duplicate = true;
                    }
                });
                if (duplicate) {
                    alert("Lĩnh vực này đã tồn tại!");
                    return;
                }
            }
            
            if (oldVal !== newName) {
                const docs = state.documents || [];
                const affectedDocsCount = docs.filter(d => getDocFields(d).includes(oldVal)).length;
                if (affectedDocsCount > 0) {
                    if (confirm(`Có ${affectedDocsCount} văn bản đang sử dụng lĩnh vực "${oldVal}". Bạn có đồng ý cập nhật lĩnh vực của các văn bản này thành "${newName}" không?`)) {
                        try {
                            await db.renameFieldInDocuments(oldVal, newName);
                            await reloadData();
                        } catch (e) {
                            console.error("Lỗi cập nhật lĩnh vực văn bản trong DB:", e);
                            alert("Lỗi khi cập nhật cơ sở dữ liệu!");
                            return;
                        }
                    } else {
                        return; // Hủy thao tác sửa
                    }
                }
            }
            
            let fieldObj = null;
            newHierarchy.forEach(sec => {
                const idx = sec.fields.findIndex(f => f.value === oldVal);
                if (idx !== -1) {
                    fieldObj = sec.fields[idx];
                    sec.fields.splice(idx, 1);
                }
            });
            
            if (fieldObj) {
                fieldObj.value = newName;
                fieldObj.label = newLabel;
            } else {
                fieldObj = { value: newName, label: newLabel };
            }
            
            if (newParentGroup) {
                const targetSec = newHierarchy.find(sec => sec.group === newParentGroup);
                if (targetSec) {
                    targetSec.fields.push(fieldObj);
                }
            } else {
                let nullSec = newHierarchy.find(sec => !sec.group);
                if (!nullSec) {
                    nullSec = { group: null, fields: [] };
                    newHierarchy.push(nullSec);
                }
                nullSec.fields.push(fieldObj);
            }
            
            newHierarchy = newHierarchy.filter(sec => sec.group || sec.fields.length > 0);
            
            saveFieldHierarchy(newHierarchy);
            closeModal();
            alert(`Đã cập nhật lĩnh vực thành công!`);
        }
    };
}

window.addEventListener('DOMContentLoaded', initApp);

