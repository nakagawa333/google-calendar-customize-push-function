import * as admin from "firebase-admin";
import { CollectionReference, DocumentData, DocumentReference, QuerySnapshot } from "firebase-admin/firestore";

/**
 * firebase admin初期化処理
 */
const init = () => {
    try{
        admin.initializeApp({});

    } catch(error:any){

    }
}

/**
 * firestoreに該当するコレクションが存在するかを判別する
 * @param collectionName 
 * @returns true:コレクションが存在 false:コレクションが存在しない
 */
const isExsitsFirestoreCollection = async(collectionName:string) => {
    //firebase admin初期化処理
    init();
    const db = admin.firestore();
    const collection = db.collection(collectionName);

    try{
        const snapShot:QuerySnapshot = await getCollection(collection,300);
        return 0 < snapShot.size; 
    } catch(error:any){
        console.error(error);
        throw new Error("firestoreのコレクション取得に失敗しました");
    }
}

const getCollection = async(
      collection:CollectionReference<DocumentData>,
      time:number
    ):Promise<QuerySnapshot> => {
        const controller = new AbortController();
        let timeId = setTimeout(() => {
            //指定経過時間が経過時、DB取得処理を中断
            controller.abort();            
        },time);

        try{
            const snapShot:QuerySnapshot = await collection.get();
            clearTimeout(timeId);
            return snapShot;
        } catch(error:any){
            console.error(error);
            throw error;
        }
}

/**
 * ドキュメント一覧を削除する
 * @param collectionName コレクション名
 * @param documentNames ドキュメント一覧
 * @returns 
 */
const deleteDocuments = async(
    collectionName:string,
    documentNames:string[]) => {
    //firebase admin初期化処理
    init();
    const db = admin.firestore();
    const isExist:boolean = await isExsitsFirestoreCollection(collectionName);

    //コレクションが存在しない場合
    if(isExist === false){
        return;
    }

    const collection = db.collection(collectionName);

    try{
        await deleteDocumentBatch(collection,documentNames,5000);
    } catch(error:any){
        console.error(error);
        throw error;
    }
}

/**
 * ドキュメント一覧を一括削除する
 * @param collection コレクション 
 * @param documentNames ドキュメント一覧
 * @param time 時間
 */
const deleteDocumentBatch = async(
    collection:CollectionReference<DocumentData>,
    documentNames:string[],
    time:number) => {
        const controller = new AbortController();
        let timeId = setTimeout(() => {
            //指定経過時間が経過時、DB取得処理を中断
            controller.abort();            
        },time);

        let listDocuments:Array<DocumentReference> = [];
        try{
            listDocuments = await collection.listDocuments();
        } catch(error:any){
            console.error(error);
            throw new Error("ドキュメント一覧取得に失敗しました");
        }

        let deviceDocumentTokens:any[] = [];
        try{
            deviceDocumentTokens = await Promise.all(
                listDocuments.map(async(listDocument:DocumentReference) => {
                    let getListDocument = await listDocument.get();
                    let data = await getListDocument.data();
                    let deviceToken = data ? data.device_token : "";
                    return deviceToken;
                })
            )
        } catch(error:any){
            console.error(error);
            throw new Error("デバイストークン取得に失敗しました");
        }

        let documentNamesSet = new Set(documentNames);
        const deleteTasks = deviceDocumentTokens
                            .filter((deviceDocumentToken) => documentNamesSet.has(deviceDocumentToken))
                            .map((deviceDocumentToken) => collection.doc(deviceDocumentToken).delete());

        try{
            await Promise.all(deleteTasks);
        } catch(error:any){
            console.error(error);
            throw new Error("");
        }

        clearTimeout(timeId);
}
 
/**
 * 対象のコレクションのドキュメントのフィールドデータを取得する
 * @param collectionName コレクション名
 * @returns ドキュメントフィールドデータ
 */
const getFirestoreDocData = async(collectionName:string) => {
    //firebase admin初期化処理
    init();
    const db = admin.firestore();
    const collectionRef = db.collection(collectionName);

    try{
        let querySnapShot = await collectionRef.get();
        return querySnapShot.docs.map((doc => doc.data()));
    } catch(error:any){
        console.error(error);
        throw new Error("firestoreのドキュメントの取得に失敗しました");
    }
}

export {isExsitsFirestoreCollection,getFirestoreDocData,deleteDocuments}
