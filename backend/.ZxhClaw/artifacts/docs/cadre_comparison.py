#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
干部信息对比工具
用于查询和对比干部/人员的基本信息
"""

import json
from typing import Dict, List, Optional


class CadreComparator:
    """干部信息对比类"""
    
    def __init__(self):
        self.cadres: Dict[str, List[Dict]] = {}
    
    def add_cadre(self, name: str, birth_date: str, archive_id: str, 
                  work_unit: str = "", position: str = ""):
        """
        添加干部信息
        
        Args:
            name: 姓名
            birth_date: 出生年月
            archive_id: 档案 ID
            work_unit: 工作单位
            position: 职务
        """
        if name not in self.cadres:
            self.cadres[name] = []
        
        self.cadres[name].append({
            "name": name,
            "birth_date": birth_date,
            "archive_id": archive_id,
            "work_unit": work_unit,
            "position": position
        })
    
    def compare(self, name1: str, name2: str) -> Dict:
        """
        对比两位干部的信息
        
        Args:
            name1: 第一位干部姓名
            name2: 第二位干部姓名
            
        Returns:
            对比结果字典
        """
        result = {
            "comparison": [],
            "conclusion": [],
            "next_steps": []
        }
        
        # 获取两人信息
        cadres1 = self.cadres.get(name1, [])
        cadres2 = self.cadres.get(name2, [])
        
        # 构建对比数据
        for cadre in cadres1 + cadres2:
            result["comparison"].append({
                "姓名": cadre["name"],
                "出生年月": cadre["birth_date"],
                "档案 ID": cadre["archive_id"],
                "工作单位": cadre["work_unit"],
                "职务": cadre["position"]
            })
        
        # 生成结论
        if len(cadres1) > 1:
            result["conclusion"].append(f"{name1} 有 {len(cadres1)} 位同名人员")
        if len(cadres2) > 1:
            result["conclusion"].append(f"{name2} 有 {len(cadres2)} 位同名人员")
        
        # 年龄对比
        if cadres1 and cadres2:
            for c1 in cadres1:
                for c2 in cadres2:
                    age_diff = self._calculate_age_diff(c1["birth_date"], c2["birth_date"])
                    result["conclusion"].append(
                        f"{c1['name']}({c1['birth_date']}) 与 {c2['name']}({c2['birth_date']}) 年龄相差约 {age_diff} 年"
                    )
        
        # 下一步建议
        result["next_steps"] = [
            "确认具体是哪一位同名人员",
            "获取完整的档案 ID 后调用档案 API 获取详细业务数据",
            "可从工作经历、职务履历、档案评分等维度进行深度比较"
        ]
        
        return result
    
    def _calculate_age_diff(self, birth1: str, birth2: str) -> int:
        """
        计算年龄差
        
        Args:
            birth1: 第一个出生年月 (格式：YYYY.MM)
            birth2: 第二个出生年月 (格式：YYYY.MM)
            
        Returns:
            年龄差（年）
        """
        try:
            year1 = int(birth1.split(".")[0])
            year2 = int(birth2.split(".")[0])
            return abs(year1 - year2)
        except (ValueError, IndexError):
            return 0
    
    def export_to_json(self, filename: str = "cadre_comparison.json"):
        """
        导出对比数据到 JSON 文件
        
        Args:
            filename: 输出文件名
        """
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(self.cadres, f, ensure_ascii=False, indent=2)
        print(f"数据已导出到 {filename}")
    
    def print_comparison(self, name1: str, name2: str):
        """
        打印对比结果
        
        Args:
            name1: 第一位干部姓名
            name2: 第二位干部姓名
        """
        result = self.compare(name1, name2)
        
        print("\n" + "=" * 60)
        print("干部信息对比")
        print("=" * 60)
        
        print("\n【基本信息对比】")
        print("-" * 60)
        print(f"{'姓名':<10} {'出生年月':<12} {'档案 ID':<40}")
        print("-" * 60)
        for cadre in result["comparison"]:
            print(f"{cadre['姓名']:<10} {cadre['出生年月']:<12} {cadre['档案 ID']:<40}")
        
        print("\n【对比结论】")
        print("-" * 60)
        for i, conclusion in enumerate(result["conclusion"], 1):
            print(f"{i}. {conclusion}")
        
        print("\n【下一步建议】")
        print("-" * 60)
        for i, step in enumerate(result["next_steps"], 1):
            print(f"{i}. {step}")
        
        print("\n" + "=" * 60)


def main():
    """主函数 - 示例用法"""
    # 创建对比器实例
    comparator = CadreComparator()
    
    # 添加示例数据
    comparator.add_cadre(
        name="张三",
        birth_date="1957.09",
        archive_id="b3b0f9b2dc864ed5a846c2ae92d2acd9",
        work_unit="",
        position=""
    )
    
    comparator.add_cadre(
        name="张三",
        birth_date="2000.01",
        archive_id="caf5e84e2d114c52ac62564e0c11d2fb",
        work_unit="",
        position=""
    )
    
    comparator.add_cadre(
        name="卢一",
        birth_date="1989.09",
        archive_id="待确认",
        work_unit="",
        position=""
    )
    
    # 打印对比结果
    comparator.print_comparison("张三", "卢一")
    
    # 导出到 JSON
    comparator.export_to_json()


if __name__ == "__main__":
    main()
