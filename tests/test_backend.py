import unittest
from backend import transition, owned_path, SaveConflict


def state():
    return dict(schema=1, phase='service', cash=300, inventory={'rice':16}, deliveries=[], complaints=0)

class StoreTests(unittest.TestCase):
    def test_owned_path_and_identity_isolation(self):
        self.assertNotEqual(owned_path('alice'), owned_path('bob'))
        with self.assertRaises(ValueError): owned_path('../bob')
        a, _ = transition(None,'alice','tab_123456','load','l',now=0)
        with self.assertRaises(PermissionError):
            transition(a,'bob','tab_123456','load','x',now=100)

    def test_delivery_server_clock_and_duplicate(self):
        s=state();s['deliveries']=[dict(id='order-1',mix={'rice':3},due=-500,serverStamped=False)]
        d,r=transition(None,'alice','tab_123456','save','s',s,0,now=1000)
        self.assertEqual(r['state']['deliveries'][0]['due'],31000)
        d,r=transition(d,'alice','tab_123456','load','l',now=30999)
        self.assertEqual(r['state']['inventory']['rice'],16)
        d,r=transition(d,'alice','tab_123456','load','l2',now=31000)
        self.assertEqual(r['state']['inventory']['rice'],19)
        d,r=transition(d,'alice','tab_123456','load','l3',now=32000)
        self.assertEqual(r['state']['inventory']['rice'],19)
        self.assertEqual(r['state']['deliveries'],[])

    def test_idempotent_save_and_revision_conflict(self):
        d,r=transition(None,'alice','tab_123456','save','id-1',state(),0,now=0)
        self.assertEqual(r['revision'],1)
        d,r=transition(d,'alice','tab_123456','save','id-1',state(),0,now=1)
        self.assertEqual(r['revision'],1)
        with self.assertRaises(SaveConflict):
            transition(d,'alice','tab_123456','save','id-2',state(),0,now=2)

    def test_tab_lease_and_release(self):
        d,_=transition(None,'alice','tab_123456','load','a',now=0)
        with self.assertRaises(SaveConflict):
            transition(d,'alice','tab_654321','load','b',now=50000)
        d,_=transition(d,'alice','tab_654321','load','c',now=55001)
        d,_=transition(d,'alice','tab_654321','release','d',now=55002)
        d,_=transition(d,'alice','tab_123456','load','e',now=55003)
        self.assertEqual(d['tab'],'tab_123456')

    def test_original_delivery_due_cannot_shift_on_autosave(self):
        s=state();s['deliveries']=[dict(id='order',mix={'rice':1},due=0)]
        d,_=transition(None,'a','tab_123456','save','a',s,0,now=1000)
        s['deliveries'][0]['due']=99999999
        d,r=transition(d,'a','tab_123456','save','b',s,1,now=2000)
        self.assertEqual(r['state']['deliveries'][0]['due'],31000)

    def test_validation(self):
        for key,value in [('cash',-1),('inventory',{'rice':-1}),('schema',2),('phase','unknown')]:
            s=state();s[key]=value
            with self.assertRaises(ValueError): transition(None,'a','tab_123456','save','a',s,0,now=0)
        s=state();s['complaints']=5
        with self.assertRaises(ValueError): transition(None,'a','tab_123456','save','a',s,0,now=0)

    def test_offline_restores_customer_clock_but_settles_delivery(self):
        s=state();s['elapsed']=73.2;s['deliveries']=[dict(id='order',mix={'rice':1},due=0)]
        d,_=transition(None,'a','tab_123456','save','a',s,0,now=1000)
        d,r=transition(d,'a','tab_654321','load','b',now=300000)
        self.assertEqual(r['state']['elapsed'],73.2)
        self.assertEqual(r['state']['inventory']['rice'],17)

if __name__ == '__main__': unittest.main()
