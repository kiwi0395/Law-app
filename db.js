// LegalDoc Auditor - Database Manager using IndexedDB

class LegalDB {
    constructor() {
        this.dbName = 'LegalDocAuditorDB';
        this.dbVersion = 2;
        this.db = null;
    }

    // Initialize database
    init() {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error("Database error: ", event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = async (event) => {
                this.db = event.target.result;
                try {
                    await this.ensureUuidsAndTimestamps();
                } catch (e) {
                    console.error("Lỗi khi nâng cấp UUIDs/Timestamps:", e);
                }
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Documents store
                if (!db.objectStoreNames.contains('documents')) {
                    const docStore = db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
                    docStore.createIndex('field', 'field', { unique: false });
                    docStore.createIndex('docType', 'docType', { unique: false });
                    docStore.createIndex('number', 'number', { unique: false });
                }

                // Notes store
                if (!db.objectStoreNames.contains('notes')) {
                    const noteStore = db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
                    noteStore.createIndex('docId', 'docId', { unique: false });
                }

                // Relations store (v2)
                if (!db.objectStoreNames.contains('relations')) {
                    const relStore = db.createObjectStore('relations', { keyPath: 'id', autoIncrement: true });
                    relStore.createIndex('sourceDocId', 'sourceDocId', { unique: false });
                    relStore.createIndex('targetDocId', 'targetDocId', { unique: false });
                    relStore.createIndex('relationType', 'relationType', { unique: false });
                }
            };
        });
    }

    // Helper: Tự động điền UUID và dấu thời gian cập nhật cho dữ liệu cũ (đồng bộ tương thích ngược)
    ensureUuidsAndTimestamps() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['documents', 'notes', 'relations'], 'readwrite');
            const ds = tx.objectStore('documents');
            const ns = tx.objectStore('notes');
            const rs = tx.objectStore('relations');

            const now = new Date().toISOString();

            // 1. Cập nhật documents
            ds.getAll().onsuccess = (e) => {
                const docs = e.target.result || [];
                docs.forEach(doc => {
                    let changed = false;
                    if (!doc.uuid) {
                        doc.uuid = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                        changed = true;
                    }
                    if (!doc.updatedAt) {
                        doc.updatedAt = doc.createdAt || now;
                        changed = true;
                    }
                    if (changed) ds.put(doc);
                });
            };

            // 2. Cập nhật notes
            ns.getAll().onsuccess = (e) => {
                const notes = e.target.result || [];
                notes.forEach(note => {
                    let changed = false;
                    if (!note.uuid) {
                        note.uuid = 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                        changed = true;
                    }
                    if (!note.updatedAt) {
                        note.updatedAt = note.createdAt || now;
                        changed = true;
                    }
                    if (changed) ns.put(note);
                });
            };

            // 3. Cập nhật relations
            rs.getAll().onsuccess = (e) => {
                const rels = e.target.result || [];
                rels.forEach(rel => {
                    let changed = false;
                    if (!rel.uuid) {
                        rel.uuid = 'rel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                        changed = true;
                    }
                    if (!rel.updatedAt) {
                        rel.updatedAt = rel.createdAt || now;
                        changed = true;
                    }
                    if (changed) rs.put(rel);
                });
            };

            tx.oncomplete = () => resolve(true);
            tx.onerror = (event) => reject(event.target.error);
        });
    }

    // --- Document Operations ---

    addDocument(doc) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['documents'], 'readwrite');
            const objectStore = transaction.objectStore('documents');
            
            const fields = Array.isArray(doc.fields) ? doc.fields : (doc.field ? [doc.field] : []);
            const now = new Date().toISOString();

            const request = objectStore.add({
                uuid: doc.uuid || ('doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)),
                title: doc.title,
                number: doc.number || '',
                docType: doc.docType, // Luật, Nghị định, Thông tư, Công văn, Quyết định, Khác
                field: fields[0] || '', // Lĩnh vực chính (giữ lại cho tương thích ngược)
                fields: fields, // Danh sách đầy đủ các lĩnh vực
                issueDate: doc.issueDate || '',
                effectiveDate: doc.effectiveDate || '',
                expiryDate: doc.expiryDate || '', // Ngày hết hiệu lực
                issuingAuthority: doc.issuingAuthority || '', // Cơ quan ban hành
                sourceUrl: doc.sourceUrl || '', // Link nguồn xem online
                parsedHtml: doc.parsedHtml || '', // Nội dung văn bản
                pdfBlob: doc.pdfBlob || null, // File PDF đính kèm
                wordBlob: doc.wordBlob || null, // File Word đính kèm
                isFavorite: doc.isFavorite || false, // Văn bản yêu thích
                createdAt: doc.createdAt || now,
                updatedAt: now
            });

            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    getAllDocuments() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['documents'], 'readonly');
            const store = transaction.objectStore('documents');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    getDocument(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['documents'], 'readonly');
            const store = transaction.objectStore('documents');
            const request = store.get(Number(id));

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    updateDocument(id, updates) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['documents'], 'readwrite');
            const store = transaction.objectStore('documents');

            const getRequest = store.get(Number(id));
            getRequest.onsuccess = () => {
                const doc = getRequest.result;
                if (!doc) {
                    reject(new Error("Document not found"));
                    return;
                }
                const fields = Array.isArray(updates.fields) ? updates.fields : (updates.field ? [updates.field] : []);

                doc.title = updates.title;
                doc.number = updates.number || '';
                doc.docType = updates.docType;
                doc.field = fields[0] || '';
                doc.fields = fields;
                doc.issueDate = updates.issueDate || '';
                doc.effectiveDate = updates.effectiveDate || '';
                doc.expiryDate = updates.expiryDate || '';
                doc.issuingAuthority = updates.issuingAuthority || '';
                doc.sourceUrl = updates.sourceUrl || '';
                doc.updatedAt = new Date().toISOString(); // Cập nhật mốc thời gian sửa đổi

                const putRequest = store.put(doc);
                putRequest.onsuccess = () => resolve(true);
                putRequest.onerror = (event) => reject(event.target.error);
            };
            getRequest.onerror = (event) => reject(event.target.error);
        });
    }

    setFavorite(id, isFavorite) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['documents'], 'readwrite');
            const store = transaction.objectStore('documents');

            const getRequest = store.get(Number(id));
            getRequest.onsuccess = () => {
                const doc = getRequest.result;
                if (!doc) {
                    reject(new Error("Document not found"));
                    return;
                }
                doc.isFavorite = !!isFavorite;
                doc.updatedAt = new Date().toISOString();

                const putRequest = store.put(doc);
                putRequest.onsuccess = () => resolve(true);
                putRequest.onerror = (event) => reject(event.target.error);
            };
            getRequest.onerror = (event) => reject(event.target.error);
        });
    }

    // Đổi tên lĩnh vực quy định trong tất cả văn bản
    renameFieldInDocuments(oldField, newField) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['documents'], 'readwrite');
            const store = transaction.objectStore('documents');
            const request = store.getAll();

            request.onsuccess = () => {
                const docs = request.result || [];
                const putPromises = [];

                docs.forEach(doc => {
                    let changed = false;
                    
                    if (doc.field === oldField) {
                        doc.field = newField;
                        changed = true;
                    }
                    
                    if (Array.isArray(doc.fields)) {
                        const index = doc.fields.indexOf(oldField);
                        if (index !== -1) {
                            doc.fields[index] = newField;
                            changed = true;
                        }
                    }
                    
                    if (changed) {
                        doc.updatedAt = new Date().toISOString();
                        const putReq = store.put(doc);
                        putPromises.push(new Promise((res, rej) => {
                            putReq.onsuccess = () => res();
                            putReq.onerror = (e) => rej(e.target.error);
                        }));
                    }
                });

                Promise.all(putPromises)
                    .then(() => resolve(true))
                    .catch(err => reject(err));
            };

            request.onerror = (event) => reject(event.target.error);
        });
    }

    // Xóa lĩnh vực quy định khỏi tất cả văn bản
    removeFieldFromDocuments(field) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['documents'], 'readwrite');
            const store = transaction.objectStore('documents');
            const request = store.getAll();

            request.onsuccess = () => {
                const docs = request.result || [];
                const putPromises = [];

                docs.forEach(doc => {
                    let changed = false;
                    
                    if (Array.isArray(doc.fields)) {
                        const index = doc.fields.indexOf(field);
                        if (index !== -1) {
                            doc.fields.splice(index, 1);
                            changed = true;
                        }
                    }

                    if (doc.field === field) {
                        doc.field = (doc.fields && doc.fields[0]) || '';
                        changed = true;
                    }
                    
                    if (changed) {
                        doc.updatedAt = new Date().toISOString();
                        const putReq = store.put(doc);
                        putPromises.push(new Promise((res, rej) => {
                            putReq.onsuccess = () => res();
                            putReq.onerror = (e) => rej(e.target.error);
                        }));
                    }
                });

                Promise.all(putPromises)
                    .then(() => resolve(true))
                    .catch(err => reject(err));
            };

            request.onerror = (event) => reject(event.target.error);
        });
    }

    // Thay thế toàn bộ dữ liệu (Phục hồi nhanh)
    replaceAll(documents, notes, relations) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['documents', 'notes', 'relations'], 'readwrite');
            const ds = tx.objectStore('documents');
            const ns = tx.objectStore('notes');
            const rs = tx.objectStore('relations');
            ds.clear();
            ns.clear();
            rs.clear();
            (documents || []).forEach(d => ds.put(d));
            (notes || []).forEach(n => ns.put(n));
            (relations || []).forEach(r => rs.put(r));
            tx.oncomplete = () => resolve(true);
            tx.onerror = (event) => reject(event.target.error);
        });
    }

    deleteDocument(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['documents', 'notes'], 'readwrite');
            const docStore = transaction.objectStore('documents');
            const noteStore = transaction.objectStore('notes');
            
            docStore.delete(Number(id));

            const noteIndex = noteStore.index('docId');
            const request = noteIndex.openCursor(IDBKeyRange.only(Number(id)));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            transaction.oncomplete = () => resolve(true);
            transaction.onerror = (event) => reject(event.target.error);
        });
    }

    // --- Note Operations ---

    addNote(note) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notes'], 'readwrite');
            const store = transaction.objectStore('notes');
            const now = new Date().toISOString();

            const request = store.add({
                uuid: note.uuid || ('note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)),
                docId: Number(note.docId),
                paragraphIndex: note.paragraphIndex,
                selectedText: note.selectedText,
                noteText: note.noteText || '',
                highlightColor: note.highlightColor || null,
                textColor: note.textColor || null,
                isBold: !!note.isBold,
                isItalic: !!note.isItalic,
                noteType: note.noteType || 'normal',
                supplementalText: note.supplementalText || '',
                refDocId: note.refDocId ? Number(note.refDocId) : null,
                isUnderline: !!note.isUnderline,
                createdAt: note.createdAt || now,
                updatedAt: now
            });

            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    getNotesForDoc(docId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notes'], 'readonly');
            const store = transaction.objectStore('notes');
            const index = store.index('docId');
            const request = index.getAll(IDBKeyRange.only(Number(docId)));

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    getAllNotes() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notes'], 'readonly');
            const store = transaction.objectStore('notes');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    deleteNote(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notes'], 'readwrite');
            const store = transaction.objectStore('notes');
            const request = store.delete(Number(id));

            request.onsuccess = (event) => resolve(true);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    updateNote(id, noteText) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notes'], 'readwrite');
            const store = transaction.objectStore('notes');
            
            const getRequest = store.get(Number(id));
            getRequest.onsuccess = () => {
                const note = getRequest.result;
                if (note) {
                    note.noteText = noteText;
                    note.updatedAt = new Date().toISOString();
                    const updateRequest = store.put(note);
                    updateRequest.onsuccess = () => resolve(true);
                    updateRequest.onerror = (event) => reject(event.target.error);
                } else {
                    reject(new Error("Note not found"));
                }
            };
            getRequest.onerror = (event) => reject(event.target.error);
        });
    }

    // --- Relation Operations ---

    addRelation(relation) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['relations'], 'readwrite');
            const store = transaction.objectStore('relations');
            const now = new Date().toISOString();

            const request = store.add({
                uuid: relation.uuid || ('rel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)),
                sourceDocId: Number(relation.sourceDocId),
                targetDocId: Number(relation.targetDocId),
                relationType: relation.relationType, // huong_dan, sua_doi, bo_sung, bai_bo, thay_the
                note: relation.note || '',
                createdAt: relation.createdAt || now,
                updatedAt: now
            });

            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    getAllRelations() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['relations'], 'readonly');
            const store = transaction.objectStore('relations');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    getRelationsForDoc(docId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['relations'], 'readonly');
            const store = transaction.objectStore('relations');
            const request = store.getAll();

            request.onsuccess = () => {
                const all = request.result;
                const related = all.filter(r => r.sourceDocId === Number(docId) || r.targetDocId === Number(docId));
                resolve(related);
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    deleteRelation(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['relations'], 'readwrite');
            const store = transaction.objectStore('relations');
            const request = store.delete(Number(id));

            request.onsuccess = () => resolve(true);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    // --- Google Drive Sync Helpers ---

    // Xuất toàn bộ dữ liệu thô kèm UUID tham chiếu của các văn bản liên quan
    async getExportData() {
        const docs = await this.getAllDocuments();
        const notes = await this.getAllNotes();
        const rels = await this.getAllRelations();

        const docIdToUuidMap = new Map(docs.map(d => [d.id, d.uuid]));

        // Ánh xạ id số sang uuid chuỗi để đồng bộ chéo thiết bị
        const exportedNotes = notes.map(n => {
            const docUuid = docIdToUuidMap.get(n.docId);
            const refDocUuid = n.refDocId ? docIdToUuidMap.get(n.refDocId) : null;
            return {
                ...n,
                docUuid,
                refDocUuid
            };
        });

        const exportedRels = rels.map(r => {
            const sourceDocUuid = docIdToUuidMap.get(r.sourceDocId);
            const targetDocUuid = docIdToUuidMap.get(r.targetDocId);
            return {
                ...r,
                sourceDocUuid,
                targetDocUuid
            };
        });

        return {
            documents: docs,
            notes: exportedNotes,
            relations: exportedRels
        };
    }

    // Nhập trộn dữ liệu từ remote (máy chủ đám mây Google Drive)
    mergeDatabase(remoteData) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!remoteData || typeof remoteData !== 'object') {
                    throw new Error("Dữ liệu đồng bộ không hợp lệ");
                }

                const localDocs = await this.getAllDocuments();
                const localNotes = await this.getAllNotes();
                const localRels = await this.getAllRelations();

                const localDocMap = new Map(localDocs.map(d => [d.uuid, d]));
                const localNoteMap = new Map(localNotes.map(n => [n.uuid, n]));
                const localRelMap = new Map(localRels.map(r => [r.uuid, r]));

                const tx = this.db.transaction(['documents', 'notes', 'relations'], 'readwrite');
                const ds = tx.objectStore('documents');
                const ns = tx.objectStore('notes');
                const rs = tx.objectStore('relations');

                const docUuidToLocalIdMap = new Map();

                // 1. Trộn documents
                const remoteDocs = remoteData.documents || [];
                for (const rDoc of remoteDocs) {
                    let lDoc = localDocMap.get(rDoc.uuid);
                    // Nếu không khớp UUID, thử tìm theo số hiệu văn bản (ngoại trừ trường hợp "Chưa rõ")
                    if (!lDoc && rDoc.number && rDoc.number !== "Chưa rõ") {
                        lDoc = localDocs.find(d => d.number === rDoc.number);
                    }

                    if (lDoc) {
                        const rTime = new Date(rDoc.updatedAt || rDoc.createdAt || 0).getTime();
                        const lTime = new Date(lDoc.updatedAt || lDoc.createdAt || 0).getTime();
                        
                        if (rTime > lTime) {
                            rDoc.id = lDoc.id; // giữ ID gốc cục bộ
                            rDoc.uuid = lDoc.uuid; // Giữ nguyên UUID cục bộ để đồng nhất
                            ds.put(rDoc);
                        }
                        docUuidToLocalIdMap.set(rDoc.uuid, lDoc.id);
                    } else {
                        // Thêm mới văn bản
                        const incomingDoc = { ...rDoc };
                        delete incomingDoc.id; // tự sinh ID mới
                        
                        const request = ds.put(incomingDoc);
                        await new Promise((res, rej) => {
                            request.onsuccess = (e) => {
                                docUuidToLocalIdMap.set(rDoc.uuid, e.target.result);
                                res();
                            };
                            request.onerror = rej;
                        });
                    }
                }

                // Nạp ID của các document cục bộ sẵn có
                for (const lDoc of localDocs) {
                    if (!docUuidToLocalIdMap.has(lDoc.uuid)) {
                        docUuidToLocalIdMap.set(lDoc.uuid, lDoc.id);
                    }
                }

                // 2. Trộn notes
                const remoteNotes = remoteData.notes || [];
                for (const rNote of remoteNotes) {
                    const localDocId = docUuidToLocalIdMap.get(rNote.docUuid);
                    if (!localDocId) continue; // bỏ qua nếu không tìm thấy văn bản chủ quản
                    
                    rNote.docId = localDocId;
                    if (rNote.refDocUuid) {
                        rNote.refDocId = docUuidToLocalIdMap.get(rNote.refDocUuid) || null;
                    }

                    const lNote = localNoteMap.get(rNote.uuid);
                    if (lNote) {
                        const rTime = new Date(rNote.updatedAt || rNote.createdAt || 0).getTime();
                        const lTime = new Date(lNote.updatedAt || lNote.createdAt || 0).getTime();
                        
                        if (rTime > lTime) {
                            rNote.id = lNote.id;
                            ns.put(rNote);
                        }
                    } else {
                        const incomingNote = { ...rNote };
                        delete incomingNote.id;
                        ns.put(incomingNote);
                    }
                }

                // 3. Trộn relations
                const remoteRels = remoteData.relations || [];
                for (const rRel of remoteRels) {
                    const localSourceId = docUuidToLocalIdMap.get(rRel.sourceDocUuid);
                    const localTargetId = docUuidToLocalIdMap.get(rRel.targetDocUuid);
                    if (!localSourceId || !localTargetId) continue;

                    rRel.sourceDocId = localSourceId;
                    rRel.targetDocId = localTargetId;

                    const lRel = localRelMap.get(rRel.uuid);
                    if (lRel) {
                        const rTime = new Date(rRel.updatedAt || rRel.createdAt || 0).getTime();
                        const lTime = new Date(lRel.updatedAt || lRel.createdAt || 0).getTime();
                        
                        if (rTime > lTime) {
                            rRel.id = lRel.id;
                            rs.put(rRel);
                        }
                    } else {
                        const incomingRel = { ...rRel };
                        delete incomingRel.id;
                        rs.put(incomingRel);
                    }
                }

                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);

            } catch (err) {
                reject(err);
            }
        });
    }
}
