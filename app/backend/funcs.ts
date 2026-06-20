import { supabase } from "./supabase";
/*
id
name
positionX
postitionY
gold
shark
shield
*/
export async function addPlayer(name:string){
    let shark = false;
    let sharkCount =0, nonShark =0;
    const {data,error} = await supabase.from('game').select("shark");
    let positionX,positionY;
    if (error){
        return {error:error.message,uuid:null};
    }
    data.forEach((val)=>{
        if (val){
            sharkCount++;
        }
        else{
            nonShark++;
        }
    })
    if (sharkCount < nonShark){
        shark = true;
    }

    positionY = Math.floor(1000 * Math.random());
    positionX = Math.floor(shark? 90 * Math.random() +10 : 90 * Math.random() + 900); 
    const {data:d1,error:e1} = await supabase.from('game').insert({name,positionX,positionY,gold:0,shark,shield:false}).select();
    if (e1){
        return {error:e1.message,uuid:null};
    }
    return {error:null,uuid:d1.uuid};
}
export async function getGold(shark:boolean){
    const {data,error} = await supabase.from('game').select("*");
    if (error) {console.error(error.message);
    console.error(error);}
    let gold =0;
    data?.forEach((value)=>{
        if (value.shark == shark){
            gold+=value.gold;
        }
    })
    return gold;
}
