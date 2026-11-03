import {redirect} from 'next/navigation';
import {pageAccount} from '@/lib/accounts/server';
import {accountsEnabled} from '@/lib/accounts/context';
import ReLister from './ReLister';
export const dynamic='force-dynamic';
export default async function Page(){if(accountsEnabled()&&!await pageAccount())redirect('/login');return <ReLister/>}
