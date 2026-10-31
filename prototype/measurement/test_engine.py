import copy,unittest
import cv2,numpy as np
from engine import detect,measure,select_front,cache_key

def geometry():
    # Known synthetic front: 50 mm lenses, 18 mm bridge, 30 mm height,
    # 138 mm complete width at 5 px/mm. Not a real-world accuracy claim.
    points={}
    for name,x in [('left',100),('right',440)]:
        points.update({name+'_left':[x/800,200/500],name+'_right':[(x+250)/800,200/500],name+'_top':[(x+125)/800,125/500],name+'_bottom':[(x+125)/800,275/500]})
    points.update({'outer_left':[50/800,200/500],'outer_right':[740/800,200/500]})
    return {'points':points,'size':[800,500],'status':'preliminary','reasons':[]}
REF={'mm':50,'source':'manual'}
class MeasurementTests(unittest.TestCase):
    def test_known_pixel_scale_and_full_span(self):
        r=measure(geometry(),REF,18)
        self.assertEqual(r['metrics'],{'lensHeightMm':30,'totalWidthMm':138})
        self.assertFalse(r['automaticListingTransfer'])
    def test_no_reference_no_measurements(self):self.assertEqual(measure(geometry(),None)['metrics'],{})
    def test_invalid_reference(self):self.assertEqual(measure(geometry(),{'mm':50,'source':'guess'})['metrics'],{})
    def test_missing_outer_only_height(self):
        g=geometry();del g['points']['outer_left'];del g['points']['outer_right']
        self.assertEqual(measure(g,REF)['metrics'],{'lensHeightMm':30})
    def test_bad_bridge_rejects(self):self.assertEqual(measure(geometry(),REF,30)['metrics'],{})
    def test_asymmetry_rejects(self):
        g=geometry();g['points']['right_right'][0]=.95
        self.assertEqual(measure(g,REF)['metrics'],{})
    def test_out_of_image_rejected(self):
        g=geometry();g['points']['left_left'][0]=-1
        with self.assertRaises(ValueError):measure(g,REF)
    def test_missing_points_no_guess(self):
        g=geometry();g['points']={'outer_left':[.1,.3]}
        self.assertEqual(measure(g,REF)['metrics'],{})
    def test_no_glasses_no_contours(self):
        _,data=cv2.imencode('.png',np.full((500,800,3),255,np.uint8))
        self.assertIsNone(detect(data.tobytes())['points'])
    def test_cache_reference_changes(self):self.assertNotEqual(cache_key([b'a'],REF,{}),cache_key([b'a'],{'mm':51,'source':'manual'},{}))
    def test_roll_compensation(self):
        g=geometry();angle=np.deg2rad(8);c,s=np.cos(angle),np.sin(angle)
        for p in g['points'].values():
            x,y=p[0]*800-400,p[1]*500-250;p[:]=[(x*c-y*s+400)/800,(x*s+y*c+250)/500]
        self.assertEqual(measure(g,REF,18)['metrics'],{'lensHeightMm':30,'totalWidthMm':138})
    def test_seeded_synthetic_detection(self):
        image=np.full((500,800,3),235,np.uint8)
        cv2.ellipse(image,(225,200),(125,75),0,0,360,(20,20,20),12)
        cv2.ellipse(image,(565,200),(125,75),0,0,360,(20,20,20),12)
        cv2.line(image,(350,180),(440,180),(20,20,20),12)
        _,data=cv2.imencode('.png',image)
        self.assertIsNotNone(detect(data.tobytes())['points'])

class GradientRefinementTests(unittest.TestCase):
    def test_refines_visible_ellipse_instead_of_rear_temple_extent(self):
        from engine import refine_opening
        image=np.full((400,600,3),110,np.uint8)
        cv2.line(image,(145,165),(210,90),(60,90,100),4)
        cv2.ellipse(image,(300,200),(120,85),0,0,360,(245,245,245),3)
        contour=np.array([[[155,200]],[[300,110]],[[423,200]],[[300,288]]],np.int32)
        result=refine_opening(image,{'box':(155,110,268,178),'contour':contour,'hole':True})
        x,y,w,h=result['box']
        self.assertAlmostEqual(w,240,delta=8)
        self.assertAlmostEqual(h,170,delta=8)
        self.assertGreaterEqual(result['edgeSupport'],.7)
    def test_no_edge_evidence_preserves_seed_without_inventing_points(self):
        from engine import refine_opening
        image=np.full((400,600,3),110,np.uint8)
        seed={'box':(155,110,268,178),'contour':np.zeros((4,1,2),np.int32),'hole':False}
        self.assertIs(refine_opening(image,seed),seed)


class RimlessHorizonTests(unittest.TestCase):
    def test_visible_lower_glass_edge_not_table_horizon(self):
        image=np.full((500,800,3),110,np.uint8);image[200:]=225
        for centre in [(225,210),(565,210)]:
            cv2.ellipse(image,centre,(125,100),0,0,360,(245,245,245),2)
        cv2.line(image,(350,185),(440,185),(210,210,210),2)
        _,data=cv2.imencode('.png',image)
        result=measure(detect(data.tobytes()),REF,18)
        self.assertIn('lensHeightMm',result['metrics'])
        self.assertAlmostEqual(result['metrics']['lensHeightMm'],40,delta=3)


class ResolutionTests(unittest.TestCase):
    def test_thumbnail_is_explicitly_rejected(self):
        _,data=cv2.imencode('.png',np.full((105,140,3),255,np.uint8))
        result=detect(data.tobytes())
        self.assertEqual(result['status'],'unavailable')
        self.assertIn('Bildauflösung',result['reasons'][0])

if __name__=='__main__':unittest.main()
