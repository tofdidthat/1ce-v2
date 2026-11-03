import React from 'react';
import {Link} from 'lucide-react';

// The same diagonal chain glyph is used for Copy link in profile header
// and the project context menu. This is deliberately not the generic
// profile-social-link Link2 glyph (which identifies an external URL).
export default function CopyLinkIconV2({size=17}:{size?:number}){
 return <Link size={size}/>;
}
