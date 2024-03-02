import * as admin from "firebase-admin";

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
    const collectionRef = db.collection(collectionName);

    try{
        const snapShot = await collectionRef.get();
        return 0 < snapShot.size; 
    } catch(error:any){
        console.error(error);
        throw new Error("firestoreのコレクション取得に失敗しました");
    }
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

export {isExsitsFirestoreCollection,getFirestoreDocData}
