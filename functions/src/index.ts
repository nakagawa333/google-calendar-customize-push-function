import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { BatchResponse, MulticastMessage } from "firebase-admin/lib/messaging/messaging-api";
// import {google, calendar_v3, tasks_v1} from 'googleapis';
import axios from "axios";
import * as dayjs from "dayjs";
import { calendar_v3, google } from "googleapis";
import { getFirestoreDocData, isExsitsFirestoreCollection } from "./firestore/firestore";
require('dotenv').config();

const GOOGLE_CLIENT_EMAIL:string = process.env.CLIENT_EMAIL? process.env.CLIENT_EMAIL : "";
const GOOGLE_CALENDAR_ID:string = process.env.GOOGLE_CALENDAR_ID ? process.env.GOOGLE_CALENDAR_ID : "";
const GOOGLE_PRIVATE_KEY:string = process.env.PRIVATE_KEY? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') :"";
const SCOPES:string = 'https://www.googleapis.com/auth/calendar';

/**
 * FCMでプッシュ通知を送信する
 */
export const sendPushNotificationToFcm = onRequest(async(request, response) => {
    logger.info("Hello logs!", {structuredData: true});

    const calendar:calendar_v3.Calendar | undefined = googleCalendarAuth();
    if(calendar === undefined){
        console.error("カレンダー認証に失敗しました");
        throw new Error("カレンダー認証に失敗しました");
    }

    //現在時刻
    const now = dayjs();
    //一か月後
    const oneMonthLater = now.add(1,"month");
    //一か月前
    const oneMonthAfter = now.subtract(1,"month");
    const timeMin:string = oneMonthAfter.toISOString();
    const timeMax:string = oneMonthLater.toISOString();

    //イベント
    let events;
    //タスク一覧
    let taskListIds;
    //タスク
    //   let tasks;

    let isExsitsDocument;
    let collectionName:string = "deviceToken";

    try{
        isExsitsDocument = await isExsitsFirestoreCollection(collectionName);
    } catch(error:any){
        console.error(error);
        let res = {
            "message":"コレクションの取得に失敗しました"
        }
        response.json(res).status(400);
    }

    if(!isExsitsDocument){
        let res = {
            "message":"コレクションが存在しません"
        }
        response.json(res).status(400);
    }

    let tokens:any[] = [];

    try{
        let docData = await getFirestoreDocData(collectionName);
        tokens = docData.map((field:any) => field.device_token);
    } catch(error:any){
        console.error(error);
        let res = {
            "message":"ドキュメントの取得に失敗しました"
        }
        response.json(res).status(400);
        return;
    }

    if(!Array.isArray(tokens) || tokens.length === 0){
        response.json({}).status(200);
        return;
    }

    let methodOptions = {
        calendarId: GOOGLE_CALENDAR_ID,
        timeMin:timeMin,
        timeMax:timeMax,
        singleEvents: false,
        orderBy: 'updated',
    }

    try{
        //一か月間のイベントを取得する
        events = await getAllCalendarEvents(calendar,methodOptions);
    } catch(error:any){
        console.error(error);
        let res = {
            "message":"イベントの取得に失敗しました"
        }
        response.json(res).status(400);
        return;
    }

    let multicastMessages:MulticastMessage[] = [];

    if(events){
        for(let event of events){
            //タイトル
            const summary = event.summary;
            //
            const isDateTime:boolean = event.isDateTime;
            const startDate = dayjs(event.startDate);
            const endDate = dayjs(event.endDate);

            const diffDay = startDate.diff(now, 'day');

            //開始日時
            let startDay = startDate.format("YYYY/MM/DD HH:mm");
            //終了日時
            let endDay = endDate.format("YYYY/MM/DD HH:mm");
            let body:string = `${startDay}-${endDay}\n予定の開始まで`;
            if(diffDay === 0 && isDateTime){
                const diffHour = startDate.diff(now,"hour");
                if(diffHour !== 0){
                    body += `${diffHour}時間`
                }
                const diffMinute = startDate.diff(now,"minute");
                body += `${diffMinute}分前です。`;
            } else {
                //本日
                if(diffDay === 0){
                    body = "予定は本日です。";
                } else if(diffDay < 0){
                    body += `既に${Math.abs(diffDay)}日前に予定が終了しています。`;
                } else {
                    body += `${diffDay}日前です。`;
                }
            }

            if(summary){
                const multicastMessage:MulticastMessage = {
                    notification:{
                        title:summary,
                        body:body
                    },
                    tokens:tokens
                }

                multicastMessages.push(multicastMessage);
            }
        }
    }

    try{
        //Google taskリスト取得処理
        let reqUrl:string = `https://script.google.com/macros/s/${process.env.LIST_GOOGLE_TASKS_LIST_API_ID}/exec`;
        let res = await axios.get(reqUrl);
        let taskList = res?.data.taskLists;
        taskListIds = taskList.map((task:any) => {
            return task.id;
        })
    } catch(error:any){
        console.error(error);
        let res = {
            "message":"失敗しました"
        }
        response.json(res).status(400);
    }


    try{
    let reqUrl:string = `https://script.google.com/macros/s/${process.env.GOOGLE_TASKS_API_ID}/exec`;
    let reqBody = {
        "taskListIds":taskListIds
    }
    let res:any = await axios.post(reqUrl,reqBody);
    if(res.data && Array.isArray(res.data.tasks)){
        let tasks = res.data.tasks.flat(1);
        for(let task of tasks){
            let title = task.title;
            const updated = dayjs(task.updated);
            const diffDay = updated.diff(now, 'day');

            let body = ` ${task.updated}\n`;
            //本日
            if(diffDay === 0){
                body += "予定は本日です。";
            } else if(diffDay < 0){
                body += `既に${Math.abs(diffDay)}日前にタスクが終了しています。`;
            }  else {
                body += `予定の開始まで${diffDay}日前です。`;
            }

            if(title){
                //複数デバイスに送信
                const multicastMessage:MulticastMessage = {
                    notification:{
                        title:title,
                        body:body
                    },
                    tokens:tokens
                }

                multicastMessages.push(multicastMessage);

            }
        }
    }

    } catch(error:any){
        console.error(error);
        throw new Error(error.message);
    }

    let multicastMessageTasks:Promise<BatchResponse>[] = [];

    for(let multicastMessage of multicastMessages){
        multicastMessageTasks.push(admin.messaging().sendEachForMulticast(multicastMessage));
    }

    let arrMulticastMessageTasks = sliceArray(multicastMessageTasks,3);

    for(let multicastMessageTask of arrMulticastMessageTasks){
        try{
            await sendEachForMulticastWithRetry(5,3000,0,multicastMessageTask);
        } catch(error:any){
            console.error(error);
            let res = {
                "message":"プッシュ通知の送信に失敗しました"
            }
            response.json(res).status(400);
        }

        await sleep(2000);
    }

    let res = {
        "message":"成功しました"
    }

    response.json(res).status(200);
});


/**
 * 
 * @param retryCount リトライ回数
 * @param waitTime  
 */
const sendEachForMulticastWithRetry = async(retryCount:number,waitTime:number,count:number,multicastMessageTask:any[]) => {
    if(retryCount === count) {
        console.error("メッセージの送信に失敗しました");
    }

    try{
        await Promise.all(multicastMessageTask);
    } catch(error:any){
        console.warn(`メッセージの送信に失敗しました。${count}回目`);
        setTimeout(() => {
            sendEachForMulticastWithRetry(retryCount - 1,waitTime,count + 1,multicastMessageTask);
        },waitTime);
    }
}

const sleep = async(time:number) => {
    return new Promise((reslve:any,reject:any) => {
        setTimeout(() => {
            return reslve();
        }, time);
    })
}


const sliceArray = (arr:any[],sliceNum:number) => {
    let res = [];
    let length = Math.ceil(arr.length / sliceNum);
    for(let i = 0; i < length; i++){
        let position = i * sliceNum;
        res.push(arr.slice(position,position + sliceNum));
    }
    return res;
}

/**
 * 現在時刻以降のGoogleカレンダーのイベント情報を全件取得する
 * @param calendar Googleカレンダー認証情報
 * @param timeMin 
 */
const getAllCalendarEvents = async(calendar:calendar_v3.Calendar,methodOptions:any) => {
    let events;
    let eventItems = [];

    let nextPageToken:string | undefined | null = "";
    while(nextPageToken !== undefined && nextPageToken !== null){
        try{
            events = await calendar.events.list(methodOptions);
            let data = events.data;
            let items = data.items;
            if(items){
                for(let event of items){
                    let isDateTime:boolean = true;
                    let startDate:string = "";
                    let endDate:string = "";
                    //日時指定なし
                    if(event.start?.date){
                        startDate = event.start?.date;
                        isDateTime = false;
                    }
        
                    if(event.end?.date){
                        endDate = event.end?.date
                        isDateTime = false;
                    }
        
                    if(event.start?.dateTime){
                        startDate = event.start?.dateTime
                    }
        
                    if(event.end?.dateTime){
                        endDate = event.end?.dateTime
                    }
        
                    eventItems.push({
                        id:event.id,
                        status:event.status,
                        summary:event.summary,
                        eventType:event.eventType,
                        startDate:startDate,
                        endDate:endDate,
                        isDateTime:isDateTime
                    });
                }
            }
            nextPageToken = events?.data.nextPageToken;
        } catch(error:any){
            console.error(error);
            throw new Error(error.message);
        }
    }
    return eventItems;
}

/**
 * Googleカレンダーの認証を行う
 */
const googleCalendarAuth = () => {

    let calendar:calendar_v3.Calendar;
    try{
        const jwtClient = new google.auth.JWT(
            GOOGLE_CLIENT_EMAIL,
            undefined,
            GOOGLE_PRIVATE_KEY,
            SCOPES);
        calendar = google.calendar({
            version: 'v3',
            auth: jwtClient
        });

    } catch(error:any){
        console.error(error.message,error);
        console.error("Google認証に失敗しました");
        throw new Error("Google認証に失敗しました");
    }

    return calendar;
}