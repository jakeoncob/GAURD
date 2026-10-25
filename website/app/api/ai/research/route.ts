import {env} from 'cloudflare:workers';
import {handleAI} from '../../../../server/gemma.js';
export function POST(request:Request){return handleAI(request,env);}
