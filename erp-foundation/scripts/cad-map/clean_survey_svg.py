"""Keep every registered DWG survey and its contained numeric CAD labels.

Construction marks and labels outside survey polygons are intentionally
excluded. No boundary is simplified or cropped. Element IDs stay unchanged.
"""
import argparse
import json
import re
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)

def inside(point, points):
    x, y = point
    hit = False
    for (x1,y1),(x2,y2) in zip(points, points[1:]+points[:1]):
        if (y1 > y) != (y2 > y) and x < (x2-x1)*(y-y1)/(y2-y1)+x1:
            hit = not hit
    return hit

def clean(source, output, ids_path):
    original = ET.parse(source).getroot()
    wanted = set(json.loads(Path(ids_path).read_text()))
    paths = [p for p in original.iter(f"{{{NS}}}path") if p.get("id") in wanted]
    found = {p.get("id") for p in paths}
    assert found == wanted, f"Missing survey boundaries: {wanted-found}"
    shapes = []
    for path in paths:
        assert not re.search(r"[CcQqAa]",path.get("d", "")), "A curved boundary needs explicit handling"
        numbers = [float(x) for x in re.findall(r"[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?",path.get("d", ""))]
        points = list(zip(numbers[::2],numbers[1::2]))
        xs, ys = zip(*points)
        shapes.append((min(xs),min(ys),max(xs),max(ys),points))
    left=min(s[0] for s in shapes);top=min(s[1] for s in shapes)
    right=max(s[2] for s in shapes);bottom=max(s[3] for s in shapes)
    px=(right-left)*.05;py=(bottom-top)*.05
    root = ET.Element(f"{{{NS}}}svg",{"version":"1.1","width":"100%","height":"100%","viewBox":f"{left-px} {top-py} {right-left+2*px} {bottom-top+2*py}","preserveAspectRatio":"xMidYMid meet","role":"group","aria-label":"Combined survey map: Bhavanipar, Bitta and Vandh Timbo"})
    ET.SubElement(root,f"{{{NS}}}title").text="Bhachunda Solar Project · Three village survey map"
    ET.SubElement(root,f"{{{NS}}}style").text="path{fill:#e5e9e1;stroke:#849184;stroke-width:.7;vector-effect:non-scaling-stroke}text{fill:#435144;font-family:Arial,sans-serif;pointer-events:none}path:focus{stroke:#b07b32;stroke-width:2;outline:none}"
    for path in paths:
        ET.SubElement(root,f"{{{NS}}}path",{"id":path.get("id"),"d":path.get("d"),"data-survey-boundary":"true"})
    labels = 0
    for text in original.iter(f"{{{NS}}}text"):
        value = "".join(text.itertext()).strip()
        if not re.search(r"[0-9૦-૯]", value) or len(value)>30: continue
        try: x=float(text.get("x"));y=float(text.get("y"))
        except (TypeError,ValueError): continue
        if not any(a<=x<=c and b<=y<=d and inside((x,y),points) for a,b,c,d,points in shapes): continue
        label=ET.SubElement(root,f"{{{NS}}}text",{"x":str(x),"y":str(y),"font-size":text.get("font-size","22"),"id":text.get("id",f"survey-label-{labels}")})
        label.text=value;labels+=1
    ET.ElementTree(root).write(output,encoding="utf-8",xml_declaration=True)
    print(json.dumps({"boundaries":len(paths),"labels":labels,"removed_other_elements":len(list(original))-len(paths)-labels,"viewBox":root.get("viewBox")}))

if __name__ == "__main__":
    parser=argparse.ArgumentParser();parser.add_argument("source");parser.add_argument("output");parser.add_argument("--ids",default=str(Path(__file__).with_name("registered-map-elements.json")))
    args=parser.parse_args();clean(args.source,args.output,args.ids)
