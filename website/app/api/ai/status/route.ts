import {env} from 'cloudflare:workers';
import {handleAI} from '../../../../server/gemma.js';
export function GET(request:Request){return handleAI(request,env);}
